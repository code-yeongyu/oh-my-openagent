import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { BackgroundTaskConfig } from "../../config/schema/background-task"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

type QueuePendingParentWakeCall = readonly [string, string, Record<string, unknown>, boolean, number | undefined]

type BackgroundManagerWakeInternals = BackgroundManager & {
  readonly tasks: Map<string, BackgroundTask>
  queuePendingParentWake: (
    sessionID: string,
    notification: string,
    promptContext: Record<string, unknown>,
    shouldReply: boolean,
    delayMs?: number,
  ) => void
  readonly notifyParentSession: (task: BackgroundTask) => Promise<void>
}

function createManager(config?: BackgroundTaskConfig): BackgroundManager {
  const pluginContext = unsafeTestValue<PluginInput>({
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({ data: {} }),
        status: async () => ({ data: {} }),
      },
    },
    directory: "/tmp/test-omo-wake-on-each-completion",
  })
  return new BackgroundManager({ pluginContext, ...(config ? { config } : {}) })
}

function createTask(overrides: Partial<BackgroundTask> & { id: string; status: BackgroundTask["status"] }): BackgroundTask {
  return {
    parentSessionId: "parent-session-wake-policy",
    parentMessageId: "parent-message-id",
    description: "test background task",
    prompt: "test prompt",
    agent: "test-agent",
    startedAt: new Date("2026-08-12T00:00:00.000Z"),
    ...overrides,
  }
}

function captureWakeCalls(manager: BackgroundManager): {
  readonly internals: BackgroundManagerWakeInternals
  readonly calls: QueuePendingParentWakeCall[]
} {
  const internals = unsafeTestValue<BackgroundManagerWakeInternals>(manager)
  const calls: QueuePendingParentWakeCall[] = []
  internals.queuePendingParentWake = (sessionID, notification, promptContext, shouldReply, delayMs) => {
    calls.push([sessionID, notification, promptContext, shouldReply, delayMs])
  }
  return { internals, calls }
}

describe("BackgroundManager wakeOnEachCompletion policy", () => {
  test("#given wakeOnEachCompletion is enabled #when a task completes while a sibling still runs #then the parent wake requires a reply", async () => {
    // given
    const manager = createManager({ wakeOnEachCompletion: true })
    const { internals, calls } = captureWakeCalls(manager)
    const completedTask = createTask({ id: "bg_wake_each_done", status: "completed", completedAt: new Date() })
    const runningSibling = createTask({ id: "bg_wake_each_running", status: "running" })
    internals.tasks.set(completedTask.id, completedTask)
    internals.tasks.set(runningSibling.id, runningSibling)

    try {
      // when
      await internals.notifyParentSession(completedTask)

      // then
      expect(calls).toHaveLength(1)
      const call = calls[0]
      expect(call?.[0]).toBe("parent-session-wake-policy")
      expect(call?.[3]).toBe(true)
      expect(call?.[1]).toContain("still in progress")
      expect(call?.[1]).toContain("You will be notified as each task completes.")
      expect(call?.[1]).not.toContain("You WILL be notified when ALL complete.")
    } finally {
      manager.shutdown()
    }
  })

  test("#given wakeOnEachCompletion is not set #when a task completes while a sibling still runs #then the parent wake stays no-reply", async () => {
    // given
    const manager = createManager()
    const { internals, calls } = captureWakeCalls(manager)
    const completedTask = createTask({ id: "bg_wake_default_done", status: "completed", completedAt: new Date() })
    const runningSibling = createTask({ id: "bg_wake_default_running", status: "running" })
    internals.tasks.set(completedTask.id, completedTask)
    internals.tasks.set(runningSibling.id, runningSibling)

    try {
      // when
      await internals.notifyParentSession(completedTask)

      // then
      expect(calls).toHaveLength(1)
      expect(calls[0]?.[3]).toBe(false)
      expect(calls[0]?.[1]).toContain("You WILL be notified when ALL complete.")
    } finally {
      manager.shutdown()
    }
  })

  test("#given wakeOnEachCompletion is not set #when the final task completes #then the parent wake still requires a reply", async () => {
    // given
    const manager = createManager()
    const { internals, calls } = captureWakeCalls(manager)
    const completedTask = createTask({ id: "bg_wake_all_complete", status: "completed", completedAt: new Date() })
    internals.tasks.set(completedTask.id, completedTask)

    try {
      // when
      await internals.notifyParentSession(completedTask)

      // then
      expect(calls).toHaveLength(1)
      expect(calls[0]?.[3]).toBe(true)
    } finally {
      manager.shutdown()
    }
  })
})
