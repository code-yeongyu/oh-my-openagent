/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

type SessionMessage = {
  info: { id?: string; role: string; finish?: string; tokens?: { output?: number; input?: number; reasoning?: number } }
  parts: Array<{ type: string; text?: string; reason?: string; tokens?: { output?: number } }>
}

const OUTPUT_LIMIT_ERROR = "stopped at output limit (32000 tokens), no result"

const LENGTH_TURN: SessionMessage = {
  info: { id: "msg_length", role: "assistant", finish: "length", tokens: { input: 1000, output: 32000, reasoning: 0 } },
  parts: [
    { type: "step-start" },
    { type: "step-finish", reason: "length", tokens: { output: 32000 } },
    { type: "patch" },
  ],
}

const EARLIER_WORK: SessionMessage[] = [
  { info: { role: "user" }, parts: [{ type: "text", text: "rewrite admin.el.md" }] },
  { info: { role: "assistant", finish: "stop", tokens: { output: 40 } }, parts: [{ type: "tool" }, { type: "text", text: "read the file" }] },
]

function createPluginContext(client: object): PluginInput {
  const directory = tmpdir()
  return {
    project: { id: "test-project", worktree: directory, time: { created: Date.now() } },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
    client: client as PluginInput["client"],
  }
}

type ManagerState = {
  status: string
  messages: SessionMessage[]
  messagesCalls: number
  abortCalls: string[]
  deletedSessions: string[]
  onMessages?: () => void
}

function createState(messages: SessionMessage[]): ManagerState {
  return { status: "idle", messages, messagesCalls: 0, abortCalls: [], deletedSessions: [] }
}

function createManager(state: ManagerState, sessionID: string): BackgroundManager {
  const client = {
    session: {
      status: async () => ({ data: { [sessionID]: { type: state.status } } }),
      get: async () => ({ data: { id: sessionID } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async (input: { path: { id: string } }) => {
        state.abortCalls.push(input.path.id)
        return {}
      },
      todo: async () => ({ data: [] }),
      messages: async () => {
        state.messagesCalls += 1
        state.onMessages?.()
        return { data: state.messages }
      },
    },
  }
  return new BackgroundManager({
    pluginContext: createPluginContext(client),
    config: undefined,
    enableParentSessionNotifications: false,
    onSubagentSessionDeleted: async ({ sessionID: deleted }) => {
      state.deletedSessions.push(deleted)
    },
  })
}

function observeText(manager: BackgroundManager, sessionID: string): void {
  manager.handleEvent({
    type: "message.part.updated",
    properties: { sessionID, type: "text", text: "read the file" },
  })
}

function observeAssistantUpdate(manager: BackgroundManager, sessionID: string, info: SessionMessage["info"]): void {
  manager.handleEvent({ type: "message.updated", properties: { sessionID, info: { ...info, sessionID } } })
}

function createRunningTask(sessionId: string): BackgroundTask {
  return {
    id: `bg_test_${sessionId}`,
    sessionId,
    parentSessionId: "parent-session",
    parentMessageId: "parent-msg",
    description: "Stage: admin.el.md",
    prompt: "test",
    agent: "sisyphus-junior",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 1, lastUpdate: new Date() },
  }
}

async function pollOnce(manager: BackgroundManager): Promise<void> {
  await manager["pollRunningTasks"]()
}

describe("BackgroundManager polling a session that stopped at the output token limit", () => {
  test("#given earlier output and a final assistant turn finished at the cap with no result #when the session is idle #then the task is an error and the child session is torn down", async () => {
    // given
    const sessionID = "ses-length"
    const state = createState([...EARLIER_WORK, LENGTH_TURN])
    const manager = createManager(state, sessionID)
    const task = createRunningTask(sessionID)
    manager["tasks"].set(task.id, task)
    observeText(manager, sessionID)
    observeAssistantUpdate(manager, sessionID, LENGTH_TURN.info)

    // when
    await pollOnce(manager)

    // then
    expect(task.status).toBe("error")
    expect(task.error).toBe(OUTPUT_LIMIT_ERROR)
    expect(state.abortCalls).toEqual([sessionID])
    expect(state.deletedSessions).toEqual([sessionID])
    await manager.shutdown()
  })

  test("#given a final turn cut at the cap that still delivered text #when the session is idle #then the task completes with a note", async () => {
    // given
    const sessionID = "ses-length-text"
    const textTurn: SessionMessage = {
      info: { id: "msg_text", role: "assistant", finish: "length", tokens: { output: 32000 } },
      parts: [{ type: "text", text: "partial summary of the rewrite" }],
    }
    const state = createState([...EARLIER_WORK, textTurn])
    const manager = createManager(state, sessionID)
    const task = createRunningTask(sessionID)
    manager["tasks"].set(task.id, task)
    observeText(manager, sessionID)
    observeAssistantUpdate(manager, sessionID, textTurn.info)

    // when
    await pollOnce(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("completed")
    expect(task.error).toBeUndefined()
    expect(task.completionNote).toBe("output was cut at the output limit (32000 tokens)")
  })

  test("#given observed output and no capped turn in events #when the session is idle #then it completes without fetching messages", async () => {
    // given
    const sessionID = "ses-no-length"
    const state = createState([...EARLIER_WORK])
    const manager = createManager(state, sessionID)
    const task = createRunningTask(sessionID)
    manager["tasks"].set(task.id, task)
    observeText(manager, sessionID)
    observeAssistantUpdate(manager, sessionID, { id: "msg_done", role: "assistant", finish: "stop" })

    // when
    await pollOnce(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("completed")
    expect(state.messagesCalls).toBe(0)
  })

  test("#given a capped turn was seen before a resume #when a newer assistant turn finishes normally #then the task completes", async () => {
    // given
    const sessionID = "ses-resumed"
    const finalTurn: SessionMessage = {
      info: { id: "msg_after_resume", role: "assistant", finish: "stop" },
      parts: [{ type: "text", text: "wrote the file" }],
    }
    const state = createState([...EARLIER_WORK, LENGTH_TURN])
    const manager = createManager(state, sessionID)
    const task = createRunningTask(sessionID)
    manager["tasks"].set(task.id, task)
    observeText(manager, sessionID)
    observeAssistantUpdate(manager, sessionID, LENGTH_TURN.info)

    // when
    state.messages = [...EARLIER_WORK, LENGTH_TURN, { info: { role: "user" }, parts: [{ type: "text", text: "continue" }] }, finalTurn]
    observeAssistantUpdate(manager, sessionID, { id: "msg_after_resume", role: "assistant" })
    observeAssistantUpdate(manager, sessionID, finalTurn.info)
    await pollOnce(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("completed")
    expect(task.error).toBeUndefined()
    expect(state.messagesCalls).toBe(0)
  })

  test("#given a newer assistant turn starts while the capped turn is being read #when completion decides #then it defers instead of failing", async () => {
    // given
    const sessionID = "ses-steered"
    const state = createState([...EARLIER_WORK, LENGTH_TURN])
    const manager = createManager(state, sessionID)
    const task = createRunningTask(sessionID)
    manager["tasks"].set(task.id, task)
    observeText(manager, sessionID)
    observeAssistantUpdate(manager, sessionID, LENGTH_TURN.info)
    state.onMessages = () => {
      state.onMessages = undefined
      observeAssistantUpdate(manager, sessionID, { id: "msg_steered", role: "assistant" })
    }

    // when
    await pollOnce(manager)

    // then
    expect(task.status).toBe("running")
    expect(state.abortCalls).toEqual([])
    await manager.shutdown()
  })

  test("#given the latest assistant turn finished normally after an earlier capped turn #when the session is idle #then the task completes", async () => {
    // given
    const sessionID = "ses-recovered-length"
    const state = createState([
      ...EARLIER_WORK,
      LENGTH_TURN,
      { info: { role: "assistant", finish: "stop", tokens: { output: 12 } }, parts: [{ type: "text", text: "wrote the file" }] },
    ])
    const manager = createManager(state, sessionID)
    const task = createRunningTask(sessionID)
    manager["tasks"].set(task.id, task)

    // when
    await pollOnce(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("completed")
    expect(task.error).toBeUndefined()
  })

  test("#given an idle session whose only turn was cut off with no text or tool part #when polled #then the task fails instead of staying running", async () => {
    // given
    const sessionID = "ses-length-empty"
    const state = createState([LENGTH_TURN])
    const manager = createManager(state, sessionID)
    const task = createRunningTask(sessionID)
    manager["tasks"].set(task.id, task)

    // when
    await pollOnce(manager)

    // then
    expect(task.status).toBe("error")
    expect(task.error).toBe(OUTPUT_LIMIT_ERROR)
    expect(state.abortCalls).toEqual([sessionID])
    await manager.shutdown()
  })
})
