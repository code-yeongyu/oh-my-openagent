import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { readContinuationMarker } from "../run-continuation-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BACKGROUND_COMPLETION_WAKE_PENDING_REASON } from "./background-task-marker"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

type ParentWakeNotifierForMarkerTest = {
  readonly reserveNotificationPreparation: (sessionID: string) => void
  readonly releaseNotificationPreparation: (sessionID: string) => void
  readonly requeueDispatchedParentWake: (sessionID: string, reason: string) => Promise<boolean>
  readonly requeueDispatchedParentWakeAfterEmptyAssistantTurn: (sessionID: string) => boolean
}

type BackgroundManagerMarkerInternals = BackgroundManager & {
  readonly parentWakeNotifier: ParentWakeNotifierForMarkerTest
  readonly tasks: Map<string, BackgroundTask>
  readonly pendingByParent: Map<string, Set<string>>
  readonly updateBackgroundTaskMarker: (parentSessionID: string) => void
  readonly queuePendingParentWake: (
    sessionID: string,
    notification: string,
    promptContext: Record<string, never>,
    shouldReply: boolean,
    delayMs?: number,
  ) => void
  readonly flushPendingParentWake: (sessionID: string) => Promise<void>
  readonly tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
}

const testDirectories: string[] = []

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
  while (testDirectories.length > 0) {
    const directory = testDirectories.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

function createTestDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-bg-marker-"))
  testDirectories.push(directory)
  return directory
}

function createManager(directory: string, enableParentSessionNotifications = true): BackgroundManager {
  const promptAsyncCalls: unknown[] = []
  const pluginContext = unsafeTestValue<PluginInput>({
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async (input: unknown) => {
          promptAsyncCalls.push(input)
          return { data: {} }
        },
        status: async () => ({ data: {} }),
      },
    },
    directory,
  })
  return new BackgroundManager({ pluginContext, enableParentSessionNotifications })
}

function createRunningTask(overrides: Partial<BackgroundTask> & { id: string; parentSessionId: string }): BackgroundTask {
  return {
    parentMessageId: "parent-message-id",
    description: "test background task",
    prompt: "test prompt",
    agent: "test-agent",
    status: "running",
    startedAt: new Date("2026-06-22T00:00:00.000Z"),
    ...overrides,
  }
}

async function waitForBackgroundTaskMarkerState(
  directory: string,
  parentSessionID: string,
  expectedState: "active" | "missing",
): Promise<void> {
  const deadline = Date.now() + 1_000
  let observedState: string | undefined
  while (Date.now() < deadline) {
    const marker = readContinuationMarker(directory, parentSessionID)
    observedState = marker?.sources["background-task"]?.state
    if (expectedState === "missing" && !marker) {
      return
    }
    if (observedState === expectedState) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for background-task marker ${expectedState}; last state: ${observedState ?? "missing"}`)
}

describe("BackgroundManager run continuation marker parent-wake races", () => {
  test("#given no active child tasks but a completion parent wake is preparing #when refreshing the run marker #then the marker remains active", () => {
    // given
    const directory = createTestDirectory()
    const parentSessionID = "parent-preparing-wake"
    const manager = createManager(directory)
    const internals = unsafeTestValue<BackgroundManagerMarkerInternals>(manager)
    internals.parentWakeNotifier.reserveNotificationPreparation(parentSessionID)

    try {
      // when
      internals.updateBackgroundTaskMarker(parentSessionID)

      // then
      const marker = readContinuationMarker(directory, parentSessionID)
      expect(marker?.sources["background-task"]?.state).toBe("active")
      expect(marker?.sources["background-task"]?.reason).toBe(BACKGROUND_COMPLETION_WAKE_PENDING_REASON)
    } finally {
      internals.parentWakeNotifier.releaseNotificationPreparation(parentSessionID)
      manager.shutdown()
    }
  })

  test("#given a completion parent wake is queued #when dispatch accepts it #then the marker is removed", async () => {
    // given
    const directory = createTestDirectory()
    const parentSessionID = "parent-queued-wake"
    const manager = createManager(directory)
    const internals = unsafeTestValue<BackgroundManagerMarkerInternals>(manager)
    const notification = "ALL BACKGROUND TASKS COMPLETE\nTask bg_123 completed."

    try {
      // when
      internals.queuePendingParentWake(parentSessionID, notification, {}, true, 10_000)

      // then
      const queuedMarker = readContinuationMarker(directory, parentSessionID)
      expect(queuedMarker?.sources["background-task"]?.state).toBe("active")
      expect(queuedMarker?.sources["background-task"]?.reason).toBe(BACKGROUND_COMPLETION_WAKE_PENDING_REASON)

      // when
      await internals.flushPendingParentWake(parentSessionID)

      // then
      const dispatchedMarker = readContinuationMarker(directory, parentSessionID)
      expect(dispatchedMarker).toBeNull()
    } finally {
      manager.shutdown()
    }
  })

  test("#given parent notifications are disabled #when final child completion releases preparation #then the marker is removed", async () => {
    // given
    const directory = createTestDirectory()
    const parentSessionID = "parent-disabled-notifications"
    const manager = createManager(directory, false)
    const internals = unsafeTestValue<BackgroundManagerMarkerInternals>(manager)
    const task = createRunningTask({
      id: "task-disabled-notifications",
      parentSessionId: parentSessionID,
      sessionId: "child-disabled-notifications",
    })
    internals.tasks.set(task.id, task)
    internals.pendingByParent.set(parentSessionID, new Set([task.id]))

    try {
      // when
      const completed = await internals.tryCompleteTask(task, "marker regression")

      // then
      expect(completed).toBe(true)
      const marker = readContinuationMarker(directory, parentSessionID)
      expect(marker).toBeNull()
    } finally {
      manager.shutdown()
    }
  })

  test("#given a completion parent wake is queued on the scheduled timer #when the timer flush accepts it #then the marker is removed", async () => {
    // given
    const directory = createTestDirectory()
    const parentSessionID = "parent-timer-wake"
    const manager = createManager(directory)
    const internals = unsafeTestValue<BackgroundManagerMarkerInternals>(manager)
    const notification = "ALL BACKGROUND TASKS COMPLETE\nTask bg_456 completed."

    try {
      // when
      internals.queuePendingParentWake(parentSessionID, notification, {}, true, 0)
      await waitForBackgroundTaskMarkerState(directory, parentSessionID, "missing")

      // then
      const marker = readContinuationMarker(directory, parentSessionID)
      expect(marker).toBeNull()
    } finally {
      manager.shutdown()
    }
  })

  test("#given a dispatched completion wake is requeued after session.error #when the prompt failure requeue returns #then the marker is active immediately", async () => {
    // given
    const directory = createTestDirectory()
    const parentSessionID = "parent-session-error-requeue"
    const manager = createManager(directory)
    const internals = unsafeTestValue<BackgroundManagerMarkerInternals>(manager)
    const notification = "ALL BACKGROUND TASKS COMPLETE\nTask bg_789 completed."

    try {
      internals.queuePendingParentWake(parentSessionID, notification, {}, true, 10_000)
      await internals.flushPendingParentWake(parentSessionID)
      const dispatchedMarker = readContinuationMarker(directory, parentSessionID)
      expect(dispatchedMarker).toBeNull()

      // when
      const requeued = await internals.parentWakeNotifier.requeueDispatchedParentWake(
        parentSessionID,
        "session.error",
      )

      // then
      expect(requeued).toBe(true)
      const requeuedMarker = readContinuationMarker(directory, parentSessionID)
      expect(requeuedMarker?.sources["background-task"]?.state).toBe("active")
      expect(requeuedMarker?.sources["background-task"]?.reason).toBe(BACKGROUND_COMPLETION_WAKE_PENDING_REASON)
    } finally {
      manager.shutdown()
    }
  })

  test("#given a dispatched completion wake is requeued after an empty assistant turn #when the retry is queued #then the marker is active immediately", async () => {
    // given
    const directory = createTestDirectory()
    const parentSessionID = "parent-empty-assistant-turn-requeue"
    const manager = createManager(directory)
    const internals = unsafeTestValue<BackgroundManagerMarkerInternals>(manager)
    const notification = "ALL BACKGROUND TASKS COMPLETE\nTask bg_empty completed."

    try {
      internals.queuePendingParentWake(parentSessionID, notification, {}, true, 10_000)
      await internals.flushPendingParentWake(parentSessionID)
      const dispatchedMarker = readContinuationMarker(directory, parentSessionID)
      expect(dispatchedMarker).toBeNull()

      // when
      const requeued = internals.parentWakeNotifier.requeueDispatchedParentWakeAfterEmptyAssistantTurn(parentSessionID)

      // then
      expect(requeued).toBe(true)
      const requeuedMarker = readContinuationMarker(directory, parentSessionID)
      expect(requeuedMarker?.sources["background-task"]?.state).toBe("active")
      expect(requeuedMarker?.sources["background-task"]?.reason).toBe(BACKGROUND_COMPLETION_WAKE_PENDING_REASON)
    } finally {
      manager.shutdown()
    }
  })

  test("#given a descendant task has a root session #when refreshing the run marker #then only the root session marker is written", () => {
    // given
    const directory = createTestDirectory()
    const rootSessionID = "root-run-session"
    const childParentSessionID = "child-parent-session"
    const manager = createManager(directory)
    const internals = unsafeTestValue<BackgroundManagerMarkerInternals>(manager)
    const task = createRunningTask({
      id: "task-descendant-marker",
      parentSessionId: childParentSessionID,
      rootSessionId: rootSessionID,
      sessionId: "grandchild-background-session",
    })
    internals.tasks.set(task.id, task)
    internals.pendingByParent.set(childParentSessionID, new Set([task.id]))

    try {
      // when
      internals.updateBackgroundTaskMarker(childParentSessionID)

      // then
      const rootMarker = readContinuationMarker(directory, rootSessionID)
      expect(rootMarker?.sources["background-task"]?.state).toBe("active")
      expect(rootMarker?.sources["background-task"]?.reason).toBe("1 background task(s) active")
      expect(readContinuationMarker(directory, childParentSessionID)).toBeNull()
    } finally {
      manager.shutdown()
    }
  })
})
