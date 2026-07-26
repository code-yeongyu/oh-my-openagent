import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BackgroundManager } from "./manager"
import type { PendingParentWake } from "./parent-wake-dedupe"
import type { ParentWakeNotifier } from "./parent-wake-notifier"
import type { BackgroundTask } from "./types"

const CHECKPOINT = {
  schema_version: 1,
  event: "wait_checkpoint",
  job_id: "job-1",
  status: "running",
  captured_bytes: 8_192,
  start_cursor_bytes: 4_096,
  next_cursor_bytes: 8_192,
} as const

type CheckpointManager = {
  readonly tasks: Map<string, BackgroundTask>
  readonly parentWakeNotifier: ParentWakeNotifier
  readonly processKey: (key: string) => Promise<void>
  readonly tryFallbackRetry: (
    task: BackgroundTask,
    errorInfo: { readonly name?: string; readonly message?: string },
    source: string,
  ) => Promise<boolean>
  readonly notifyParentSession: (task: BackgroundTask) => Promise<void>
  readonly flushPendingParentWake: (sessionID: string) => Promise<void>
  readonly enqueueNotificationForParent: (sessionID: string, operation: () => Promise<void>) => Promise<void>
}

function createPluginContext(
  promptAsync: () => Promise<unknown> = async () => ({ data: {} }),
  directory: string = tmpdir(),
): PluginInput {
  return unsafeTestValue<PluginInput>({
    project: { id: "test-project", worktree: directory, time: { created: Date.now() } },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {},
    client: {
      session: {
        status: async () => ({ data: {} }),
        messages: async () => ({ data: [{ info: { role: "assistant", finish: "stop", time: { created: Date.now() - 10_000 } } }] }),
        promptAsync,
        abort: async () => ({ data: {} }),
      },
    },
  })
}

function createRunningTask(): BackgroundTask {
  return {
    id: "bg_task_1",
    sessionId: "ses-current",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: "checkpoint task",
    prompt: "run a managed job",
    agent: "sisyphus-junior",
    status: "running",
    startedAt: new Date(),
    currentAttemptID: "att-current",
    attempts: [
      {
        attemptId: "att-old",
        attemptNumber: 1,
        sessionId: "ses-old",
        status: "error",
      },
      {
        attemptId: "att-current",
        attemptNumber: 2,
        sessionId: "ses-current",
        status: "running",
      },
    ],
  }
}

function checkpointText(manager: CheckpointManager): string | undefined {
  return manager.parentWakeNotifier
    .getPendingParentWakes()
    .get("parent-session")
    ?.notifications[0]
}

function queueCheckpoint(manager: BackgroundManager): void {
  manager.handleEvent({
    type: "message.part.updated",
    properties: {
      sessionID: "ses-current",
      part: {
        type: "tool",
        tool: "managed_bash",
        state: {
          status: "completed",
          input: { action: "wait" },
          metadata: { managed_bash_checkpoint: CHECKPOINT },
        },
      },
    },
  })
}

describe("BackgroundManager managed-bash checkpoint events", () => {
  test("#given a current running child calls managed_bash wait #when its success event carries v1 metadata #then parent progress is queued", async () => {
    // given
    const manager = new BackgroundManager({ pluginContext: createPluginContext() })
    const internals = unsafeTestValue<CheckpointManager>(manager)
    internals.tasks.set("bg_task_1", createRunningTask())
    manager.handleEvent({
      type: "session.next.tool.called",
      properties: {
        sessionID: "ses-current",
        callID: "call-1",
        tool: "managed_bash",
        input: { action: "wait", job_id: "job-1" },
      },
    })

    try {
      // when
      manager.handleEvent({
        type: "session.next.tool.success",
        properties: {
          sessionID: "ses-current",
          callID: "call-1",
          structured: { managed_bash_checkpoint: CHECKPOINT },
        },
      })

      // then
      expect(checkpointText(internals)).toContain("[MANAGED BASH CHECKPOINT]")
      expect(checkpointText(internals)).toContain("8192")
    } finally {
      await manager.shutdown()
    }
  })

  test("#given a checkpoint arrives from a historical retry session #when handled #then current parent progress stays empty", async () => {
    // given
    const manager = new BackgroundManager({ pluginContext: createPluginContext() })
    const internals = unsafeTestValue<CheckpointManager>(manager)
    internals.tasks.set("bg_task_1", createRunningTask())
    manager.handleEvent({
      type: "session.next.tool.called",
      properties: {
        sessionID: "ses-old",
        callID: "call-old",
        tool: "managed_bash",
        input: { action: "wait", job_id: "job-1" },
      },
    })

    try {
      // when
      manager.handleEvent({
        type: "session.next.tool.success",
        properties: {
          sessionID: "ses-old",
          callID: "call-old",
          structured: { managed_bash_checkpoint: CHECKPOINT },
        },
      })

      // then
      expect(internals.parentWakeNotifier.getPendingParentWakes().has("parent-session")).toBe(false)
    } finally {
      await manager.shutdown()
    }
  })

  test("#given only a persisted completed managed_bash part is retained #when handled #then it queues the compatibility checkpoint", async () => {
    // given
    const manager = new BackgroundManager({ pluginContext: createPluginContext() })
    const internals = unsafeTestValue<CheckpointManager>(manager)
    internals.tasks.set("bg_task_1", createRunningTask())

    try {
      // when
      manager.handleEvent({
        type: "message.part.updated",
        properties: {
          sessionID: "ses-current",
          part: {
            sessionID: "ses-current",
            type: "tool",
            callID: "call-fallback",
            tool: "managed_bash",
            state: {
              status: "completed",
              input: { action: "wait", job_id: "job-1" },
              output: "rendered output must not be parsed",
              metadata: { managed_bash_checkpoint: CHECKPOINT },
            },
          },
        },
      })

      // then
      expect(checkpointText(internals)).toContain("[MANAGED BASH CHECKPOINT]")
      expect(checkpointText(internals)).not.toContain("rendered output")
    } finally {
      await manager.shutdown()
    }
  })

  test("#given queued checkpoint progress #when actual fallback retry succeeds #then the failed attempt checkpoint is purged", async () => {
    // given
    const manager = new BackgroundManager({ pluginContext: createPluginContext() })
    const internals = unsafeTestValue<CheckpointManager>(manager)
    const task = createRunningTask()
    task.model = { providerID: "openai", modelID: "gpt-5" }
    task.fallbackChain = [{ model: "claude-haiku-4-5", providers: ["anthropic"] }]
    task.attemptCount = 0
    internals.tasks.set(task.id, task)
    queueCheckpoint(manager)
    Reflect.set(manager, "processKey", async () => {})

    try {
      // when
      const retried = await internals.tryFallbackRetry(task, {
        name: "APIError",
        message: "Forbidden: Selected provider is forbidden",
      }, "test")

      // then
      expect(retried).toBe(true)
      expect(internals.parentWakeNotifier.getPendingParentWakes().get(task.parentSessionId)?.notifications)
        .not.toContainEqual(expect.stringContaining("[MANAGED BASH CHECKPOINT]"))
    } finally {
      await manager.shutdown()
    }
  })

  test("#given queued checkpoint progress #when actual completion notification runs #then final wake supersedes and purges checkpoint state", async () => {
    // given
    const manager = new BackgroundManager({ pluginContext: createPluginContext() })
    const internals = unsafeTestValue<CheckpointManager>(manager)
    const task = createRunningTask()
    task.status = "completed"
    task.completedAt = new Date()
    internals.tasks.set(task.id, task)
    queueCheckpoint(manager)

    try {
      // when
      await internals.enqueueNotificationForParent(task.parentSessionId, () => internals.notifyParentSession(task))

      // then
      const wake = internals.parentWakeNotifier.getPendingParentWakes().get(task.parentSessionId)
      expect(wake?.notifications.some((notification) => notification.includes("[MANAGED BASH CHECKPOINT]"))).toBe(false)
      expect(wake?.latestOnlyNotifications).toBeUndefined()
    } finally {
      await manager.shutdown()
    }
  })

  test("#given checkpoint dispatch is in flight #when retry purge queues before dispatch failure #then stale attempt cannot requeue", async () => {
    // given
    let rejectDispatch = (_error: Error): void => {}
    let markDispatchStarted = (): void => {}
    const dispatchStarted = new Promise<void>((resolve) => { markDispatchStarted = resolve })
    const dispatchResult = new Promise<unknown>((_resolve, reject) => { rejectDispatch = reject })
    const manager = new BackgroundManager({ pluginContext: createPluginContext(async () => {
      markDispatchStarted()
      return dispatchResult
    }) })
    const internals = unsafeTestValue<CheckpointManager>(manager)
    const task = createRunningTask()
    task.model = { providerID: "openai", modelID: "gpt-5" }
    task.fallbackChain = [{ model: "claude-haiku-4-5", providers: ["anthropic"] }]
    task.attemptCount = 0
    internals.tasks.set(task.id, task)
    queueCheckpoint(manager)
    internals.parentWakeNotifier.clearPendingParentWakeTimer(task.parentSessionId)
    Reflect.set(manager, "processKey", async () => {})
    const flush = internals.enqueueNotificationForParent(task.parentSessionId, () => internals.flushPendingParentWake(task.parentSessionId))
    await dispatchStarted

    try {
      // when
      const retry = internals.tryFallbackRetry(task, { name: "APIError", message: "Forbidden: Selected provider is forbidden" }, "test")
      rejectDispatch(new Error("dispatch failed"))
      await flush
      await retry

      // then
      expect(internals.parentWakeNotifier.getPendingParentWakes().get(task.parentSessionId)?.notifications
        .some((notification) => notification.includes("[MANAGED BASH CHECKPOINT]"))).toBe(false)
    } finally {
      rejectDispatch(new Error("cleanup"))
      await manager.shutdown()
    }
  })

  test("#given queued checkpoint progress #when cancellation skips notification #then observer and wake state are purged", async () => {
    // given
    const manager = new BackgroundManager({ pluginContext: createPluginContext() })
    const internals = unsafeTestValue<CheckpointManager>(manager)
    const task = createRunningTask()
    internals.tasks.set(task.id, task)
    queueCheckpoint(manager)

    try {
      // when
      const cancelled = await manager.cancelTask(task.id, { skipNotification: true, source: "test" })

      // then
      expect(cancelled).toBe(true)
      expect(internals.parentWakeNotifier.getPendingParentWakes().has(task.parentSessionId)).toBe(false)
    } finally {
      await manager.shutdown()
    }
  })
})
