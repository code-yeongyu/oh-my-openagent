import { afterEach, describe, expect, test } from "bun:test"
import {
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../../hooks/shared/prompt-async-gate"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type ParentWakeNotifierClientForTest = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]
type PromptAsyncCall = Parameters<ParentWakeNotifierClientForTest["session"]["promptAsync"]>[0]

type SessionMessageStub = {
  readonly info?: {
    readonly role?: string
    readonly finish?: string
    readonly time?: { readonly created?: number }
  }
  readonly parts?: readonly { readonly type?: string; readonly text?: string }[]
}

const FINAL_WAKE = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>"

function createNotifier(options: {
  readonly messagesProvider: () => readonly SessionMessageStub[]
  readonly noAssistantOutputRetryDeadlineMs?: number
  readonly noAssistantOutputRetryBaseDelayMs?: number
}): {
  readonly notifier: ParentWakeNotifier
  readonly promptAsyncCalls: readonly PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client: ParentWakeNotifierClientForTest = {
    session: {
      messages: async () => ({ data: options.messagesProvider() }),
      status: async () => ({ data: {} }),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return { data: {} }
      },
    },
  }
  const notifier = new ParentWakeNotifier(
    {
      client,
      directory: "/tmp/test-omo",
      enqueueNotificationForParent: async (_sessionID, operation) => {
        await operation()
      },
    },
    {
      pendingRetryMs: 1_000,
      acceptedMessageSkewMs: 100,
      toolCallDeferMaxMs: 5_000,
      failureRequeueWindowMs: 1,
      userMessageInProgressWindowMs: 0,
      ...(options.noAssistantOutputRetryDeadlineMs !== undefined
        ? { noAssistantOutputRetryDeadlineMs: options.noAssistantOutputRetryDeadlineMs }
        : {}),
      ...(options.noAssistantOutputRetryBaseDelayMs !== undefined
        ? { noAssistantOutputRetryBaseDelayMs: options.noAssistantOutputRetryBaseDelayMs }
        : {}),
    },
  )
  return { notifier, promptAsyncCalls }
}

async function waitForTimer(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 15)
  })
}

function releaseParentWakeHold(sessionID: string): void {
  const released = releasePromptAsyncReservation(sessionID, "test:simulate-expired-parent-wake-hold", {
    reservedBy: "background-agent-parent-wake",
  })
  expect(released).toBe(true)
}

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
})

describe("ParentWakeNotifier idle-parent no-output retry (2026-10-19 ses_eede11ad incident)", () => {
  test("#given an idle parent wake whose first dispatch produces no assistant output #when the retry flushes #then the 15s semantic coalesce window does not suppress the retry", async () => {
    // given — no assistant output exists in the parent session
    const { notifier, promptAsyncCalls } = createNotifier({
      messagesProvider: () => [],
    })
    const sessionID = "parent-idle-no-output-retry-not-coalesced"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)

      // when — the failure window elapses with no output, requeueing the wake
      await waitForTimer()
      expect(notifier.getPendingParentWakes().get(sessionID)?.noAssistantOutputRetryCount).toBe(1)

      releaseParentWakeHold(sessionID)
      notifier.clearPendingParentWakeTimer(sessionID)
      await notifier.flushPendingParentWake(sessionID)

      // then — the retry actually dispatched instead of being coalesced away
      // by the recent semantic dispatch from the first attempt
      expect(promptAsyncCalls).toHaveLength(2)
      expect(promptAsyncCalls[1]?.body.noReply).toBe(false)
      expect(JSON.stringify(promptAsyncCalls[1]?.body.parts)).toContain("ALL BACKGROUND TASKS COMPLETE")
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given an idle parent wake whose dispatch produces assistant output #when the recovery window elapses #then no retry is scheduled", async () => {
    // given — assistant output lands after the dispatch
    const { notifier, promptAsyncCalls } = createNotifier({
      messagesProvider: () => [
        {
          info: {
            role: "assistant",
            finish: "stop",
            time: { created: Date.now() },
          },
          parts: [{ type: "text", text: "seen the result" }],
        },
      ],
    })
    const sessionID = "parent-idle-output-no-retry"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)

      // when — the failure window elapses
      await waitForTimer()

      // then — the wake was cleared after observing assistant output; no retry
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)
      expect(notifier.getPendingParentWakeTimers().has(sessionID)).toBe(false)
      expect(promptAsyncCalls).toHaveLength(1)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })

  test("#given an idle parent wake that keeps producing no assistant output #when the retry deadline exhausts #then a visible noReply notice is deposited into the parent session and the cycle terminates", async () => {
    // given — a short deadline and fast backoff so the cycle exhausts quickly
    const { notifier, promptAsyncCalls } = createNotifier({
      messagesProvider: () => [],
      noAssistantOutputRetryDeadlineMs: 45,
      noAssistantOutputRetryBaseDelayMs: 1,
    })
    const sessionID = "parent-idle-deadline-visible-fallback"
    notifier.queuePendingParentWake(sessionID, FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake(sessionID)
      expect(promptAsyncCalls).toHaveLength(1)

      // when — drive the no-output retry cycle until the deadline notice is queued
      let deadlineNoticeQueued = false
      for (let attempt = 0; attempt < 12 && !deadlineNoticeQueued; attempt++) {
        releaseParentWakeHold(sessionID)
        await waitForTimer()
        const pendingWake = notifier.getPendingParentWakes().get(sessionID)
        deadlineNoticeQueued = pendingWake?.noAssistantOutputDeadlineNotice === true
        if (!deadlineNoticeQueued) {
          notifier.clearPendingParentWakeTimer(sessionID)
          await notifier.flushPendingParentWake(sessionID)
        }
      }
      expect(deadlineNoticeQueued).toBe(true)
      // Retries actually dispatched — none were swallowed by the coalesce window
      expect(promptAsyncCalls.length).toBeGreaterThanOrEqual(2)

      // when — the deadline notice flushes (release is best-effort: the last
      // dispatch may not hold a gate reservation any more)
      releasePromptAsyncReservation(sessionID, "test:simulate-expired-parent-wake-hold", {
        reservedBy: "background-agent-parent-wake",
      })
      notifier.clearPendingParentWakeTimer(sessionID)
      await notifier.flushPendingParentWake(sessionID)

      // then — a visible noReply deposit landed in the parent session with the
      // notification text, so the owner sees the result even with no turn
      const depositCall = promptAsyncCalls.at(-1)
      expect(depositCall?.body.noReply).toBe(true)
      expect(JSON.stringify(depositCall?.body.parts)).toContain("ALL BACKGROUND TASKS COMPLETE")

      // and — the deposit's recovery window terminates the cycle
      await waitForTimer()
      expect(notifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
      expect(notifier.getPendingParentWakes().has(sessionID)).toBe(false)
      expect(notifier.getPendingParentWakeTimers().has(sessionID)).toBe(false)
    } finally {
      notifier.shutdown()
      releaseAllPromptAsyncReservationsForTesting()
    }
  })
})
