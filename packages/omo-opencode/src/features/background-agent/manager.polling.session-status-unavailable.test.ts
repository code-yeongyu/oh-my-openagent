/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { MIN_SESSION_GONE_POLLS } from "./session-existence"
import type { BackgroundTask } from "./types"

type SessionStatus = { type: string }
type SessionStatusResponse = { data: Record<string, SessionStatus> }
type SessionGetResponse = { data: Record<string, unknown> | null; error?: { status?: number } | null }
type SessionOverrides = {
  status?: (() => Promise<SessionStatusResponse>) | undefined
  get?: (() => Promise<SessionGetResponse>) | undefined
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
    get: overrides.get ?? (async () => ({ data: { id: "session" } })),
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
  test("keeps running tasks active and checks session existence when status is unavailable or throws", async () => {
    const cases: Array<{ name: string; status?: () => Promise<SessionStatusResponse> }> = [
      { name: "missing status method" },
      { name: "throwing status method", status: async () => { throw new Error("status unavailable") } },
    ]

    for (const testCase of cases) {
      // given
      let abortCallCount = 0
      const manager = createManager({
        status: testCase.status,
        get: async () => ({ data: { id: "session" } }),
        abort: async () => {
          abortCallCount += 1
          return {}
        },
      })
      const task = createRunningTask(`ses-${testCase.name.replaceAll(" ", "-")}`)
      injectTask(manager, task)

      // when
      await poll(manager, MIN_SESSION_GONE_POLLS + 1)

      // then: status unavailable but session still exists → task stays running
      // consecutiveMissedPolls is reset after session existence is verified
      expect(task.status).toBe("running")
      expect(task.completedAt).toBeUndefined()
      expect(task.error).toBeUndefined()
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

  test("marks task as error when session status is unavailable and session no longer exists after threshold polls", async () => {
    // given
    const manager = createManager({
      get: async () => ({ data: null }),
    })
    const task = createRunningTask("ses-gone-no-status-available")
    injectTask(manager, task)

    // when
    await poll(manager, MIN_SESSION_GONE_POLLS + 1)

    // then
    expect(task.status).toBe("error")
    expect(task.error).toContain("no longer exists")
    expect(task.completedAt).toBeDefined()

    await manager.shutdown()
  })

  test("keeps task running when session status is unavailable but session still exists after threshold polls", async () => {
    // given
    const manager = createManager({
      get: async () => ({ data: { id: "session" } }),
    })
    const task = createRunningTask("ses-alive-no-status-available")
    injectTask(manager, task)

    // when
    await poll(manager, MIN_SESSION_GONE_POLLS + 1)

    // then
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()

    await manager.shutdown()
  })
})
