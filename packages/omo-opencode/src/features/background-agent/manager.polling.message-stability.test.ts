/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { MIN_RUNTIME_BEFORE_STALE_MS, MIN_STABILITY_TIME_MS } from "./constants"
import type { BackgroundTask } from "./types"

type SessionStatus = { type: string }
type SessionMessage = {
  info?: { role?: string; finish?: unknown; time?: { completed?: unknown } }
  parts?: Array<{ type: string; text?: string }>
}
type ManagerOverrides = {
  status?: (() => Promise<{ data: Record<string, SessionStatus> }>) | undefined
  messages: () => SessionMessage[]
  abort?: () => Promise<object>
}

const RUNNING_FOR_MS = MIN_RUNTIME_BEFORE_STALE_MS + 5_000
const STABLE_FOR_MS = MIN_STABILITY_TIME_MS + 1_000

function finishedAssistant(text: string): SessionMessage {
  return { info: { role: "assistant", finish: "end_turn" }, parts: [{ type: "text", text }] }
}

function unfinishedAssistant(text: string): SessionMessage {
  return { info: { role: "assistant" }, parts: [{ type: "text", text }] }
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
  let abortCount = 0
  const session = {
    ...(overrides.status === undefined ? {} : { status: overrides.status }),
    get: async () => ({ data: { id: "session" } }),
    prompt: async () => ({}),
    promptAsync: async () => ({}),
    abort: overrides.abort ?? (async () => { abortCount += 1; return {} }),
    todo: async () => ({ data: [] }),
    messages: async () => ({ data: overrides.messages() }),
  }
  const client = { session }
  const manager = new BackgroundManager({
    pluginContext: { client, directory: tmpdir() } as PluginInput,
    enableParentSessionNotifications: false,
  })
  ;(manager as unknown as { _abortCount: () => number })._abortCount = () => abortCount
  return manager
}

function injectTask(manager: BackgroundManager, task: BackgroundTask): void {
  ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(task.id, task)
}

async function poll(manager: BackgroundManager): Promise<void> {
  await (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()
}

describe("BackgroundManager pollRunningTasks message-stability completion fallback", () => {
  test("#given status is unavailable and the last assistant message is finished and stable for 10s #when polled #then the task completes", async () => {
    // given
    const manager = createManager({
      status: undefined,
      messages: () => [finishedAssistant("done")],
    })
    const task = createRunningTask("ses-stable-finished")
    task.lastMsgCount = 1
    task.lastMessageCountChangedAt = new Date(Date.now() - STABLE_FOR_MS)
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
      messages: () => Array.from({ length: count }, (_, index) => finishedAssistant(`chunk-${index}`)),
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

  test("#given the last assistant message is unfinished but the count is stable for 10s #when polled #then the task does NOT complete", async () => {
    // given
    const manager = createManager({
      status: undefined,
      messages: () => [unfinishedAssistant("still generating")],
    })
    const task = createRunningTask("ses-unfinished")
    task.lastMsgCount = 1
    task.lastMessageCountChangedAt = new Date(Date.now() - STABLE_FOR_MS)
    injectTask(manager, task)

    // when
    await poll(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.completedAt).toBeUndefined()
  })

  test("#given a finished stable message but the task has only been running briefly #when polled #then the runtime throttle prevents completion", async () => {
    // given
    const manager = createManager({
      status: undefined,
      messages: () => [finishedAssistant("done")],
    })
    const task = createRunningTask("ses-too-young")
    task.startedAt = new Date()
    task.lastMsgCount = 1
    task.lastMessageCountChangedAt = new Date(Date.now() - STABLE_FOR_MS)
    injectTask(manager, task)

    // when
    await poll(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.completedAt).toBeUndefined()
  })
})
