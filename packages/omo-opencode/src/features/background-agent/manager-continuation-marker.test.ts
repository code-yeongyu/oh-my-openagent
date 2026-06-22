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

type ParentWakeNotifierForMarkerTest = {
  readonly reserveNotificationPreparation: (sessionID: string) => void
  readonly releaseNotificationPreparation: (sessionID: string) => void
  readonly requeueDispatchedParentWake: (sessionID: string, reason: string) => Promise<boolean>
  readonly requeueDispatchedParentWakeAfterEmptyAssistantTurn: (sessionID: string) => boolean
}

type BackgroundManagerMarkerInternals = BackgroundManager & {
  readonly parentWakeNotifier: ParentWakeNotifierForMarkerTest
  readonly updateBackgroundTaskMarker: (parentSessionID: string) => void
  readonly queuePendingParentWake: (
    sessionID: string,
    notification: string,
    promptContext: Record<string, never>,
    shouldReply: boolean,
    delayMs?: number,
  ) => void
  readonly flushPendingParentWake: (sessionID: string) => Promise<void>
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

function createManager(directory: string): BackgroundManager {
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
  return new BackgroundManager({ pluginContext })
}

async function waitForBackgroundTaskMarkerState(
  directory: string,
  parentSessionID: string,
  expectedState: "active" | "idle",
): Promise<void> {
  const deadline = Date.now() + 1_000
  let observedState: string | undefined
  while (Date.now() < deadline) {
    const marker = readContinuationMarker(directory, parentSessionID)
    observedState = marker?.sources["background-task"]?.state
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

  test("#given a completion parent wake is queued #when dispatch accepts it #then the marker returns idle", async () => {
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
      expect(dispatchedMarker?.sources["background-task"]?.state).toBe("idle")
    } finally {
      manager.shutdown()
    }
  })

  test("#given a completion parent wake is queued on the scheduled timer #when the timer flush accepts it #then the marker returns idle", async () => {
    // given
    const directory = createTestDirectory()
    const parentSessionID = "parent-timer-wake"
    const manager = createManager(directory)
    const internals = unsafeTestValue<BackgroundManagerMarkerInternals>(manager)
    const notification = "ALL BACKGROUND TASKS COMPLETE\nTask bg_456 completed."

    try {
      // when
      internals.queuePendingParentWake(parentSessionID, notification, {}, true, 0)
      await waitForBackgroundTaskMarkerState(directory, parentSessionID, "idle")

      // then
      const marker = readContinuationMarker(directory, parentSessionID)
      expect(marker?.sources["background-task"]?.state).toBe("idle")
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
      expect(dispatchedMarker?.sources["background-task"]?.state).toBe("idle")

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
      expect(dispatchedMarker?.sources["background-task"]?.state).toBe("idle")

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
})
