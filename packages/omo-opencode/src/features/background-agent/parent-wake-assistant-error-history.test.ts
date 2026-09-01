import { afterEach, describe, expect, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { ParentWakeNotifier } from "./parent-wake-notifier"

type ParentWakeNotifierClient = ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]
type SessionMessageStub = {
  readonly info?: {
    readonly role?: string
    readonly finish?: string
    readonly error?: unknown
    readonly time?: { readonly created?: number }
  }
  readonly parts?: readonly { readonly type?: string; readonly text?: string }[]
}

const FINAL_WAKE = "<system-reminder>\n[BACKGROUND TASK COMPLETED]\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>"

function createNotifier(messages: readonly SessionMessageStub[]): ParentWakeNotifier {
  const client: ParentWakeNotifierClient = {
    session: {
      messages: async () => ({ data: messages }),
      status: async () => ({ data: {} }),
      promptAsync: async () => ({ data: {} }),
    },
  }
  return new ParentWakeNotifier(
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
      failureRequeueWindowMs: 10,
      userMessageInProgressWindowMs: 0,
    },
  )
}

describe("ParentWakeNotifier assistant error history", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("requeues late session.error when history only shows the injected wake plus an assistant error turn with no parts", async () => {
    // given
    const dispatchedAt = Date.now()
    const notifier = createNotifier([
      {
        info: {
          role: "assistant",
          finish: "stop",
          time: { created: dispatchedAt - 5_000 },
        },
      },
      {
        info: {
          role: "user",
          time: { created: dispatchedAt + 1 },
        },
        parts: [{ type: "text", text: `${FINAL_WAKE}\n<!-- OMO_INTERNAL_INITIATOR -->` }],
      },
      {
        info: {
          role: "assistant",
          finish: "error",
          error: { message: "late failure" },
          time: { created: dispatchedAt + 2 },
        },
        parts: [],
      },
    ])
    notifier.queuePendingParentWake("parent-assistant-error-history", FINAL_WAKE, { agent: "sisyphus" }, true)

    try {
      await notifier.flushPendingParentWake("parent-assistant-error-history")
      expect(notifier.getDispatchedParentWakes().has("parent-assistant-error-history")).toBe(true)

      // when
      const requeued = await notifier.requeueDispatchedParentWake(
        "parent-assistant-error-history",
        "late session.error",
      )

      // then
      expect(requeued).toBe(true)
      expect(
        notifier.getPendingParentWakes().get("parent-assistant-error-history")?.notifications,
      ).toEqual([FINAL_WAKE])
      expect(notifier.getDispatchedParentWakes().has("parent-assistant-error-history")).toBe(false)
    } finally {
      notifier.shutdown()
    }
  })
})
