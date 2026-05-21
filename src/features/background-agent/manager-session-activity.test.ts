import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

type PollingManager = {
  readonly pollRunningTasks: () => Promise<void>
  readonly tasks: Map<string, BackgroundTask>
}

function createPluginContext(client: unknown): PluginInput {
  const directory = tmpdir()
  return unsafeTestValue<PluginInput>({
    project: {
      id: "test-project",
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {},
    client,
  })
}

function createRunningTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_test_session_activity",
    sessionId: "ses-active",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: "test task",
    prompt: "test prompt",
    agent: "explore",
    status: "running",
    startedAt: new Date(Date.now() - 120_000),
    progress: { toolCalls: 0, lastUpdate: new Date() },
    ...overrides,
  }
}

describe("BackgroundManager persisted session activity stale checks", () => {
  const originalDateNow = Date.now
  const fixedTime = new Date("2026-05-21T03:00:00.000Z").getTime()

  afterEach(() => {
    Date.now = originalDateNow
    mock.restore()
  })

  test("keeps a busy task running when session.get reports fresh activity", async () => {
    //#given - live event progress is stale, but OpenCode session metadata was updated recently
    spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
    let abortCallCount = 0
    const sessionGet = mock(async () => ({
      data: {
        id: "ses-active",
        time: { updated: fixedTime - 10_000 },
      },
    }))
    const client = {
      session: {
        status: async () => ({ data: { "ses-active": { type: "busy" } } }),
        get: sessionGet,
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => {
          abortCallCount += 1
          return {}
        },
        todo: async () => ({ data: [] }),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({
      pluginContext: createPluginContext(client),
      config: { staleTimeoutMs: 180_000 },
      enableParentSessionNotifications: false,
    })
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 45 * 60 * 1000),
      progress: {
        toolCalls: 3,
        lastUpdate: new Date(Date.now() - 45 * 60 * 1000),
      },
    })
    const pollingManager = unsafeTestValue<PollingManager>(manager)
    pollingManager.tasks.set(task.id, task)

    //#when - polling reaches stale confirmation for the active child session
    await pollingManager.pollRunningTasks()

    //#then - persisted activity refreshes the task instead of aborting it
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(task.progress?.lastUpdate).toEqual(new Date(fixedTime - 10_000))
    expect(abortCallCount).toBe(0)
    expect(sessionGet).toHaveBeenCalledTimes(1)

    await manager.shutdown()
  })

  test("keeps a busy task running when session.get returns an error response", async () => {
    //#given - live event progress is stale and OpenCode session lookup fails without throwing
    spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
    let abortCallCount = 0
    const sessionGet = mock(async () => ({
      error: "lookup failed",
      data: undefined,
    }))
    const client = {
      session: {
        status: async () => ({ data: { "ses-active": { type: "busy" } } }),
        get: sessionGet,
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => {
          abortCallCount += 1
          return {}
        },
        todo: async () => ({ data: [] }),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({
      pluginContext: createPluginContext(client),
      config: { staleTimeoutMs: 180_000 },
      enableParentSessionNotifications: false,
    })
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 45 * 60 * 1000),
      progress: {
        toolCalls: 3,
        lastUpdate: new Date(Date.now() - 45 * 60 * 1000),
      },
    })
    const pollingManager = unsafeTestValue<PollingManager>(manager)
    pollingManager.tasks.set(task.id, task)

    //#when - polling tries to confirm stale activity through the SDK response
    await pollingManager.pollRunningTasks()

    //#then - the lookup failure defers cancellation for the active child session
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(abortCallCount).toBe(0)
    expect(sessionGet).toHaveBeenCalledTimes(1)

    await manager.shutdown()
  })
})
