/// <reference types="bun-types" />

import { describe, test, expect, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { handleSessionIdleBackgroundEvent } from "./session-idle-event-handler"
import type { BackgroundTask } from "./types"

type FixtureMessage = { info?: { id?: string; role?: string }; parts?: Array<{ type?: string; text?: string }> }

function createPluginContext(client: object): PluginInput {
  const directory = tmpdir()
  return {
    project: {
      id: "test-project",
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
    client: client as PluginInput["client"],
  }
}

function previousRunMessages(): FixtureMessage[] {
  return [
    { info: { id: "msg_launch", role: "user" }, parts: [{ type: "text", text: "launch prompt" }] },
    { info: { id: "msg_prev_answer", role: "assistant" }, parts: [{ type: "text", text: "previous run answer" }] },
  ]
}

function createManagerWithMessages(messages: FixtureMessage[], options?: { appendOnPrompt?: boolean }) {
  const aborts: string[] = []
  const prompts: string[][] = []
  const client = {
    session: {
      status: async () => ({ data: { ses_bg_anchor: { type: "idle" } } }),
      get: async () => ({ data: { id: "ses_bg_anchor" } }),
      prompt: async () => ({}),
      promptAsync: async (request: { body: { parts: Array<{ text?: string }> } }) => {
        prompts.push(request.body.parts.map((part) => part.text ?? ""))
        if (options?.appendOnPrompt) {
          messages.push({
            info: { id: `msg_continue_user_${messages.length}`, role: "user" },
            parts: [{ type: "text", text: "continuation prompt" }],
          })
        }
        return { data: {} }
      },
      abort: async () => {
        aborts.push("aborted")
        return { data: true }
      },
      todo: async () => ({ data: [] }),
      messages: async () => ({ data: messages }),
    },
  }
  const manager = new BackgroundManager({
    pluginContext: createPluginContext(client),
    config: undefined,
    enableParentSessionNotifications: false,
  })
  return { manager, prompts, aborts }
}

function createCompletedTask(): BackgroundTask {
  return {
    id: "bg_anchor",
    status: "completed",
    sessionId: "ses_bg_anchor",
    parentSessionId: "ses_parent",
    parentMessageId: "msg_parent",
    description: "synthetic task",
    prompt: "launch prompt",
    agent: "explore",
    concurrencyGroup: "explore",
    completedAt: new Date(),
    startedAt: new Date(Date.now() - 60_000),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

const resumeInput = {
  sessionId: "ses_bg_anchor",
  prompt: "continue",
  parentSessionId: "ses_parent",
  parentMessageId: "msg_parent",
}

let managers: BackgroundManager[] = []

function track(manager: BackgroundManager): BackgroundManager {
  managers.push(manager)
  return manager
}

afterEach(() => {
  for (const manager of managers) {
    manager.shutdown()
  }
  managers = []
})

describe("BackgroundManager resume completion anchor", () => {
  test("poller does not re-complete a resumed task on the previous run's output", async () => {
    //#given
    const messages = previousRunMessages()
    const { manager, aborts } = createManagerWithMessages(messages)
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    // The previous run's part events marked this session's output observed, so
    // validateSessionHasOutput short-circuits true on the cached entry.
    manager["observedOutputSessions"].add(task.sessionId!)

    //#when
    const resumed = await manager.resume(resumeInput)
    expect(resumed.status).toBe("running")
    expect(resumed.resumeAnchor).toEqual({ anchorMessageCount: 2, anchorMessageID: "msg_prev_answer" })
    // The continuation prompt has not landed yet; the previous run's output is
    // still all the session contains.
    await manager.pollRunningTasks()

    //#then
    expect(task.status).toBe("running")
    expect(aborts).toHaveLength(0)
  })

  test("resumed task completes once a new turn exists after the anchor", async () => {
    //#given
    const messages = previousRunMessages()
    const { manager, aborts } = createManagerWithMessages(messages)
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    manager["observedOutputSessions"].add(task.sessionId!)

    //#when
    await manager.resume(resumeInput)
    // The continuation turn ran and produced a new assistant message.
    messages.push({
      info: { id: "msg_new_answer", role: "assistant" },
      parts: [{ type: "text", text: "continuation answer" }],
    })
    await manager.pollRunningTasks()

    //#then
    expect(task.status).toBe("completed")
    expect(task.resumeAnchor).toBeUndefined()
    expect(aborts).toHaveLength(1)
  })

  test("session.idle handler waits for a message after the resume anchor", async () => {
    //#given
    const messages = previousRunMessages()
    const { manager } = createManagerWithMessages(messages)
    track(manager)
    const task = createCompletedTask()
    task.status = "running"
    task.startedAt = new Date(Date.now() - 60_000)
    task.resumeAnchor = { anchorMessageCount: 2, anchorMessageID: "msg_prev_answer" }
    manager["tasks"].set(task.id, task)
    const completions: string[] = []
    const deps = {
      properties: { sessionID: task.sessionId },
      findBySession: () => task,
      idleDeferralTimers: new Map(),
      validateSessionHasOutput: () => manager["validateSessionHasOutput"](task.sessionId!),
      sessionHasMessagesAfterAnchor: (sessionID: string, candidate: BackgroundTask) =>
        manager["sessionHasMessagesAfterAnchor"](sessionID, candidate),
      checkSessionTodos: () => manager["checkSessionTodos"](task.sessionId!),
      tryCompleteTask: (candidate: BackgroundTask, source: string) => {
        completions.push(source)
        return manager["tryCompleteTask"](candidate, source)
      },
      emitIdleEvent: () => {},
    }

    //#when
    handleSessionIdleBackgroundEvent(deps)
    await new Promise((resolve) => setTimeout(resolve, 30))

    //#then
    expect(completions).toHaveLength(0)
    expect(task.status).toBe("running")

    //#when
    messages.push({
      info: { id: "msg_new_answer", role: "assistant" },
      parts: [{ type: "text", text: "continuation answer" }],
    })
    handleSessionIdleBackgroundEvent(deps)
    await new Promise((resolve) => setTimeout(resolve, 30))

    //#then
    expect(completions).toHaveLength(1)
    expect(task.status).toBe("completed")
  })
})
