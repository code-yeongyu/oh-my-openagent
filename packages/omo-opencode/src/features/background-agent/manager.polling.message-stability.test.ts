/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { MIN_RUNTIME_BEFORE_STALE_MS, MIN_STABILITY_TIME_MS } from "./constants"
import type { BackgroundTask } from "./types"

type SessionStatus = { type: string }
type SessionPart = { type: string; text?: string }
type SessionMessage = {
  info?: { role?: string; finish?: unknown; id?: string }
  parts?: SessionPart[]
}
type Todo = { content: string; status: string; priority: string; id?: string }
type ManagerOverrides = {
  status?: (() => Promise<{ data: Record<string, SessionStatus> }>) | undefined
  messages: () => SessionMessage[]
  todos?: () => Todo[]
  abort?: () => Promise<object>
}

const RUNNING_FOR_MS = MIN_RUNTIME_BEFORE_STALE_MS + 5_000
const STABLE_FOR_MS = MIN_STABILITY_TIME_MS + 1_000

// Message ids are compared lexically (assistant must come AFTER the user), so use
// zero-padded ids that sort correctly.
function userMessage(id: string, text: string): SessionMessage {
  return { info: { role: "user", id }, parts: [{ type: "text", text }] }
}

function assistantMessage(id: string, finish: unknown, parts: SessionPart[]): SessionMessage {
  return { info: { role: "assistant", id, finish }, parts }
}

// A normal completed turn: user prompt followed by a finished assistant reply with text.
function completedTurn(): SessionMessage[] {
  return [
    userMessage("msg-0001", "do the thing"),
    assistantMessage("msg-0002", "stop", [{ type: "text", text: "done" }]),
  ]
}

function createRunningTask(sessionId: string): BackgroundTask {
  return {
    id: `bg_test_${sessionId}`,
    sessionId,
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: "test task",
    prompt: "test prompt",
    agent: "explore",
    status: "running",
    startedAt: new Date(Date.now() - RUNNING_FOR_MS),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

function createManager(overrides: ManagerOverrides): BackgroundManager {
  const session = {
    ...(overrides.status === undefined ? {} : { status: overrides.status }),
    get: async () => ({ data: { id: "session" } }),
    prompt: async () => ({}),
    promptAsync: async () => ({}),
    abort: overrides.abort ?? (async () => ({})),
    todo: async () => ({ data: overrides.todos ? overrides.todos() : [] }),
    messages: async () => ({ data: overrides.messages() }),
  }
  const client = { session }
  return new BackgroundManager({
    pluginContext: { client, directory: tmpdir() } as PluginInput,
    enableParentSessionNotifications: false,
  })
}

function injectTask(manager: BackgroundManager, task: BackgroundTask): void {
  ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(task.id, task)
}

// Pre-seed the stability window so a single poll observes a stable, aged message count.
function seedStable(task: BackgroundTask, count: number): void {
  task.lastMsgCount = count
  task.lastMessageCountChangedAt = new Date(Date.now() - STABLE_FOR_MS)
}

async function poll(manager: BackgroundManager): Promise<void> {
  await (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()
}

describe("BackgroundManager pollRunningTasks message-stability completion fallback", () => {
  test("#given status is unavailable and the last assistant turn is terminally finished and stable for 10s #when polled #then the task completes", async () => {
    // given
    const manager = createManager({ status: undefined, messages: () => completedTurn() })
    const task = createRunningTask("ses-stable-finished")
    seedStable(task, 2)
    injectTask(manager, task)

    // when
    await poll(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("completed")
    expect(task.completedAt).toBeDefined()
  })

  test("#given the session status stays busy but messages keep growing #when polled repeatedly #then the task never completes", async () => {
    // given
    let count = 1
    const manager = createManager({
      status: async () => ({ data: { "ses-busy-growing": { type: "busy" } } }),
      messages: () =>
        Array.from({ length: count }, (_, index) =>
          assistantMessage(`msg-${String(index).padStart(4, "0")}`, "stop", [{ type: "text", text: `chunk-${index}` }]),
        ),
    })
    const task = createRunningTask("ses-busy-growing")
    injectTask(manager, task)

    // when: each poll observes a larger message count, which resets the stability window
    await poll(manager)
    task.lastMessageCountChangedAt = new Date(Date.now() - STABLE_FOR_MS)
    count = 2
    await poll(manager)
    task.lastMessageCountChangedAt = new Date(Date.now() - STABLE_FOR_MS)
    count = 3
    await poll(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.completedAt).toBeUndefined()
  })

  test("#given the last assistant message has no finish reason but the count is stable #when polled #then the task does NOT complete", async () => {
    // given
    const manager = createManager({
      status: undefined,
      messages: () => [
        userMessage("msg-0001", "go"),
        assistantMessage("msg-0002", undefined, [{ type: "text", text: "still generating" }]),
      ],
    })
    const task = createRunningTask("ses-unfinished")
    seedStable(task, 2)
    injectTask(manager, task)

    // when
    await poll(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.completedAt).toBeUndefined()
  })

  test("#given the last assistant message finished with reason tool-calls #when polled #then the task does NOT complete (mid tool-loop)", async () => {
    // given
    const manager = createManager({
      status: undefined,
      messages: () => [
        userMessage("msg-0001", "go"),
        assistantMessage("msg-0002", "tool-calls", [{ type: "tool", text: "" }]),
      ],
    })
    const task = createRunningTask("ses-tool-calls")
    seedStable(task, 2)
    injectTask(manager, task)

    // when
    await poll(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.completedAt).toBeUndefined()
  })

  test("#given the last assistant message finished with reason unknown #when polled #then the task does NOT complete", async () => {
    // given
    const manager = createManager({
      status: undefined,
      messages: () => [
        userMessage("msg-0001", "go"),
        assistantMessage("msg-0002", "unknown", [{ type: "text", text: "partial" }]),
      ],
    })
    const task = createRunningTask("ses-unknown-finish")
    seedStable(task, 2)
    injectTask(manager, task)

    // when
    await poll(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.completedAt).toBeUndefined()
  })

  test("#given an old finished assistant turn followed by a newer user message #when polled #then the task does NOT complete (turn superseded by new prompt)", async () => {
    // given
    const manager = createManager({
      status: undefined,
      messages: () => [
        userMessage("msg-0001", "first"),
        assistantMessage("msg-0002", "stop", [{ type: "text", text: "old answer" }]),
        userMessage("msg-0003", "follow-up just arrived"),
      ],
    })
    const task = createRunningTask("ses-superseded")
    seedStable(task, 3)
    injectTask(manager, task)

    // when
    await poll(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.completedAt).toBeUndefined()
  })

  test("#given a finished stable turn but incomplete todos #when polled #then the task does NOT complete (idle-path todo gate)", async () => {
    // given
    const manager = createManager({
      status: undefined,
      messages: () => completedTurn(),
      todos: () => [{ content: "still pending", status: "pending", priority: "high", id: "t1" }],
    })
    const task = createRunningTask("ses-incomplete-todos")
    seedStable(task, 2)
    injectTask(manager, task)

    // when
    await poll(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.completedAt).toBeUndefined()
  })

  test("#given a finished stable turn but the task has only been running briefly #when polled #then the runtime throttle prevents completion", async () => {
    // given
    const manager = createManager({ status: undefined, messages: () => completedTurn() })
    const task = createRunningTask("ses-too-young")
    task.startedAt = new Date()
    seedStable(task, 2)
    injectTask(manager, task)

    // when
    await poll(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.completedAt).toBeUndefined()
  })
})
