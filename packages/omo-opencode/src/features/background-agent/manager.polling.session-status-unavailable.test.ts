/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { MIN_SESSION_GONE_POLLS } from "./session-existence"
import type { BackgroundTask } from "./types"

type SessionStatus = { type: string }
type SessionStatusResponse = { data?: Record<string, SessionStatus> | null; error?: unknown } | Record<string, SessionStatus> | undefined
type SessionOverrides = {
  status?: ((options?: { signal?: AbortSignal }) => Promise<SessionStatusResponse>) | undefined
  abort?: () => Promise<object>
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
    startedAt: new Date(),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

function createManager(overrides: SessionOverrides): BackgroundManager {
  const session = {
    ...(overrides.status === undefined ? {} : { status: overrides.status }),
    get: async () => ({ data: { id: "session" } }),
    prompt: async () => ({}),
    promptAsync: async () => ({}),
    abort: overrides.abort ?? (async () => ({})),
    todo: async () => ({ data: [] }),
    messages: async () => ({
      data: [{
        info: { role: "assistant", finish: "end_turn", id: "message-2" },
        parts: [{ type: "text", text: "done" }],
      }],
    }),
  }
  const client = { session }

  return new BackgroundManager({
    pluginContext: { client, directory: tmpdir() } as PluginInput,
    enableParentSessionNotifications: false,
  })
}

async function poll(manager: BackgroundManager, cycles: number): Promise<void> {
  for (let count = 0; count < cycles; count += 1) {
    await manager["pollRunningTasks"]()
  }
}

function injectTask(manager: BackgroundManager, task: BackgroundTask): void {
  manager["tasks"].set(task.id, task)
}

describe("BackgroundManager pollRunningTasks when session status registry is unavailable", () => {
  test("keeps running tasks active and does not increment missed polls when status is unavailable or throws", async () => {
    const cases: Array<{ name: string; status?: () => Promise<SessionStatusResponse> }> = [
      { name: "missing status method" },
      { name: "throwing status method", status: async () => { throw new Error("status unavailable") } },
      { name: "resolved error envelope", status: async () => ({ error: new Error("status unavailable") }) },
      { name: "missing registry", status: async () => ({ data: undefined }) },
      { name: "null registry", status: async () => ({ data: null }) },
      { name: "undefined response", status: async () => undefined },
    ]

    for (const testCase of cases) {
      // given
      let abortCallCount = 0
      const manager = createManager({
        status: testCase.status,
        abort: async () => {
          abortCallCount += 1
          return {}
        },
      })
      const task = createRunningTask(`ses-${testCase.name.replaceAll(" ", "-")}`)
      injectTask(manager, task)

      // when
      await poll(manager, MIN_SESSION_GONE_POLLS + 1)

      // then
      expect(task.status).toBe("running")
      expect(task.completedAt).toBeUndefined()
      expect(task.error).toBeUndefined()
      expect(task.consecutiveMissedPolls ?? 0).toBe(0)
      expect(abortCallCount).toBe(0)

      await manager.shutdown()
    }
  })

  test("completes a task when a reliable status response omits the session", async () => {
    // given
    const manager = createManager({
      status: async () => ({ data: {} }),
    })
    const task = createRunningTask("ses-gone-after-reliable-status")
    injectTask(manager, task)

    // when
    await poll(manager, MIN_SESSION_GONE_POLLS)
    await manager.shutdown()

    // then
    expect(task.status).toBe("completed")
    expect(task.completedAt).toBeDefined()
  })
})

// Protect recurring recovery against a registry request that never settles.
describe("BackgroundManager stalled status transport", () => {
  test("expires queued tasks after aborting a stalled request, then retries without overlap", async () => {
    let calls = 0
    let active = 0
    let maxActive = 0
    let signal: AbortSignal | undefined
    let release!: (value: SessionStatusResponse) => void
    const manager = createManager({ status: async (options) => {
      calls += 1
      if (calls > 1) return { data: { "ses-live": { type: "busy" } } }
      active += 1
      maxActive = Math.max(maxActive, active)
      signal = options?.signal
      return new Promise<SessionStatusResponse>((resolve, reject) => {
        release = resolve
        signal?.addEventListener("abort", () => { active -= 1; reject(signal?.reason) }, { once: true })
      })
    } })
    const live = createRunningTask("ses-live")
    const queued = { ...createRunningTask("ses-queued"), id: "bg_expired_queue", status: "pending" as const, sessionId: undefined, queuedAt: new Date(1) }
    injectTask(manager, live)
    injectTask(manager, queued)
    let circuit: ReturnType<typeof setTimeout> | undefined
    try {
      const first = manager["pollRunningTasks"]()
      await manager["pollRunningTasks"]()
      await Promise.race([first, new Promise((_, reject) => { circuit = setTimeout(() => reject(new Error("stalled registry blocked task expiry past 7s")), 7000) })])
      expect(signal?.aborted).toBe(true)
      expect(queued.status).toBe("error")
      expect(live.status).toBe("running")
      expect(live.consecutiveMissedPolls ?? 0).toBe(0)
      await manager["pollRunningTasks"]()
      expect(calls).toBe(2)
      expect(active).toBe(0)
      expect(maxActive).toBe(1)
    } finally {
      clearTimeout(circuit)
      release?.({ data: {} })
      await manager.shutdown()
    }
  }, 12000)

  test("shutdown aborts a request and suppresses late polling recovery", async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let signal: AbortSignal | undefined
    let release!: (value: SessionStatusResponse) => void
    const pending = new Promise<SessionStatusResponse>((resolve) => { release = resolve })
    const manager = createManager({ status: async (options) => { signal = options?.signal; started(); return pending } })
    const polling = manager["pollRunningTasks"]()
    await ready
    try {
      await manager.shutdown()
      expect(signal?.aborted).toBe(true)
    } finally { release({ data: {} }); await polling }
    expect(manager.getTasksSnapshot()).toHaveLength(0)
  })
})


test("BackgroundManager preserves a validated raw busy registry instead of completing a live task",async()=>{
  const manager=createManager({status:async()=>({"ses-raw-live":{type:"busy"}})})
  const task=createRunningTask("ses-raw-live")
  injectTask(manager,task)
  try {
    await poll(manager,MIN_SESSION_GONE_POLLS+1)
    expect(task.status).toBe("running")
    expect(task.consecutiveMissedPolls??0).toBe(0)
    expect(task.completedAt).toBeUndefined()
  } finally {await manager.shutdown()}
})
