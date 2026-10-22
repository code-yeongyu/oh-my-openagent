/// <reference types="bun-types" />

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { clearPromptReservationsForTesting } from "@oh-my-opencode/utils/prompt-async-gate/reservations"
import { clearRecentPromptDispatchesForTesting } from "@oh-my-opencode/utils/prompt-async-gate/recent-dispatches"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

const SESSION = "ses_resumed"
const WORKTREE = mkdtempSync(join(tmpdir(), "resume-anchor-"))
const resumeInput = { sessionId: SESSION, prompt: "continue", parentSessionId: "ses_parent", parentMessageId: "msg_parent" }

type Message = { info: { id: string; role: string; time: { completed: number } }; parts: Array<{ type: string; text: string }> }
type Read = () => Promise<unknown>

function message(id: string, role: string, text: string): Message {
  return { info: { id, role, time: { completed: Date.now() } }, parts: [{ type: "text", text }] }
}

let managers: BackgroundManager[] = []

function setup() {
  const messages = [message("msg_launch", "user", "launch"), message("msg_previous", "assistant", "previous answer")]
  const reads: Array<string | undefined> = []
  const aborts: string[] = []
  const dispatched = Promise.withResolvers<void>()
  const session = {
    status: async (): Promise<unknown> => ({ data: { [SESSION]: { type: "idle" } } }),
    messages: async (request?: { query?: { directory?: string } }): Promise<unknown> => {
      reads.push(request?.query?.directory)
      return { data: [...messages] }
    },
    promptAsync: async () => { dispatched.resolve(); return { data: {} } },
    prompt: async () => ({}),
    abort: async (request: { path: { id: string } }) => { aborts.push(request.path.id); return { data: true } },
    todo: async () => ({ data: [] }),
    get: async () => ({ data: { id: SESSION } }),
  }
  const pluginContext = {
    project: { id: "test-project", worktree: WORKTREE, time: { created: Date.now() } },
    directory: tmpdir(),
    worktree: tmpdir(),
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
    client: { session } as unknown as PluginInput["client"],
  } satisfies PluginInput
  const manager = new BackgroundManager({ pluginContext, config: { defaultConcurrency: 1 }, enableParentSessionNotifications: false })
  managers.push(manager)
  const task: BackgroundTask = {
    id: "bg_resumed", status: "completed", sessionId: SESSION, cwd: WORKTREE, parentSessionId: "ses_parent",
    parentMessageId: "msg_parent", description: "synthetic task", prompt: "launch", agent: "explore",
    concurrencyGroup: "explore", completedAt: new Date(), startedAt: new Date(Date.now() - 60_000),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
  manager["tasks"].set(task.id, task)
  // The previous run's output was already observed, so the generic output check passes on it.
  manager["observedOutputSessions"].add(SESSION)
  return { manager, task, session, messages, reads, aborts, dispatched: dispatched.promise }
}

async function resumed() {
  const fixture = setup()
  await fixture.manager.resume(resumeInput)
  await fixture.dispatched
  return fixture
}

const failedReads: Array<[string, Read]> = [
  ["rejects", () => Promise.reject(new TypeError("fetch failed"))],
  ["returns an SDK error", async () => ({ error: { name: "UnknownError" } })],
  ["never settles", () => new Promise(() => {})],
]

beforeEach(() => {
  clearPromptReservationsForTesting()
  clearRecentPromptDispatchesForTesting()
})

afterEach(async () => {
  for (const manager of managers) await manager.shutdown()
  managers = []
})

afterAll(() => rmSync(WORKTREE, { recursive: true, force: true }))

describe("resuming a completed background task", () => {
  test("does not complete it on the previous run's output", async () => {
    const { manager, task, aborts } = await resumed()

    await manager["pollRunningTasks"]()

    expect(task.status).toBe("running")
    expect(aborts).toHaveLength(0)
  })

  test("does not complete it on a session.idle event before the continuation answered", async () => {
    const { manager, task, aborts } = await resumed()
    task.startedAt = new Date(Date.now() - 60_000)

    manager.handleEvent({ type: "session.idle", properties: { sessionID: SESSION } })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(task.status).toBe("running")
    expect(aborts).toHaveLength(0)
  })

  test("does not count the continuation's own user message as output", async () => {
    const { manager, task, messages } = await resumed()
    messages.push(message("msg_continue", "user", "continue"))

    await manager["pollRunningTasks"]()

    expect(task.status).toBe("running")
  })

  test("completes it once the continuation answered and the session is idle", async () => {
    const { manager, task, messages, reads, aborts } = await resumed()
    messages.push(message("msg_answer", "assistant", "continuation answer"))

    await manager["pollRunningTasks"]()

    expect(task.status).toBe("completed")
    expect(aborts).toEqual([SESSION])
    expect(reads.every((directory) => directory === WORKTREE)).toBe(true)
  })

  test("keeps it running when the session turned busy again after the answer was read", async () => {
    const { manager, task, session, messages } = await resumed()
    messages.push(message("msg_answer", "assistant", "first step"))
    const readMessages = session.messages
    session.messages = async (request) => {
      session.status = async () => ({ data: { [SESSION]: { type: "busy" } } })
      return readMessages(request)
    }

    await manager["pollRunningTasks"]()

    expect(task.status).toBe("running")
  })

  test("keeps it running when a retry moved the task to another session during the check", async () => {
    const { manager, task, session, messages, aborts } = await resumed()
    messages.push(message("msg_partial", "assistant", "partial answer before the failure"))
    const pending = Promise.withResolvers<unknown>()
    const entered = Promise.withResolvers<void>()
    session.messages = () => { entered.resolve(); return pending.promise }
    const poll = manager["pollRunningTasks"]()
    await entered.promise

    task.sessionId = "ses_retry"
    pending.resolve({ data: [...messages] })
    await poll

    expect(task.status).toBe("running")
    expect(aborts).toHaveLength(0)
  })

  test.each(failedReads)("keeps it running when the check's message read %s", async (_label, read) => {
    const { manager, task, session, messages, aborts } = await resumed()
    messages.push(message("msg_answer", "assistant", "continuation answer"))
    session.messages = read

    await manager["pollRunningTasks"]()

    expect(task.status).toBe("running")
    expect(manager["pollingInFlight"]).toBe(false)
    expect(aborts).toHaveLength(0)
  }, 10_000)

  test.each(failedReads)("rejects the resume, without dispatching, when the message read %s", async (_label, read) => {
    const { manager, task, session } = setup()
    let prompts = 0
    session.messages = read
    session.promptAsync = async () => { prompts += 1; return { data: {} } }

    await expect(manager.resume(resumeInput)).rejects.toThrow()

    expect(task.status).toBe("completed")
    expect(manager["concurrencyManager"].getCount("explore")).toBe(0)
    expect(manager["completionTimers"].has(task.id)).toBe(true)
    expect(prompts).toBe(0)
  }, 10_000)

  test("takes the anchor when a queued resume is admitted, not when it was queued", async () => {
    const { manager, task, messages, dispatched, aborts } = setup()
    const slots = manager["concurrencyManager"]
    await slots.acquire("explore")
    await manager.resume(resumeInput)
    messages.push(message("msg_wake", "assistant", "answer to a wake while the resume waited"))

    slots.release("explore")
    await dispatched
    await manager["pollRunningTasks"]()

    expect(task.status).toBe("running")
    expect(aborts).toHaveLength(0)
  })

  test("restores a queued resume whose messages cannot be read at admission", async () => {
    const { manager, task, session } = setup()
    let prompts = 0
    session.promptAsync = async () => { prompts += 1; return { data: {} } }
    const slots = manager["concurrencyManager"]
    await slots.acquire("explore")
    await manager.resume(resumeInput)
    session.messages = () => Promise.reject(new TypeError("fetch failed"))

    slots.release("explore")
    await new Promise((resolve) => setImmediate(resolve))

    expect(task.status).toBe("completed")
    expect(slots.getCount("explore")).toBe(0)
    expect(prompts).toBe(0)
  })

  test("rejects the resume when the manager shuts down while the messages are read", async () => {
    const { manager, task, session } = setup()
    const pending = Promise.withResolvers<unknown>()
    const entered = Promise.withResolvers<void>()
    session.messages = () => { entered.resolve(); return pending.promise }
    const resume = manager.resume(resumeInput)
    await entered.promise

    await manager.shutdown()
    pending.resolve({ data: [] })

    await expect(resume).rejects.toThrow()
    expect(task.status).toBe("completed")
  })
})
