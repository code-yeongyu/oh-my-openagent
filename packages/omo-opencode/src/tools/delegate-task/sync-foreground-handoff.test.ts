import { describe, expect, test } from "bun:test"
import { SYNC_POLL_HANDED_OFF, startForegroundHandoffTimer } from "./sync-foreground-handoff"
import { pollSyncSession } from "./sync-session-poller"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("startForegroundHandoffTimer", () => {
  test("#given handoff is off (0 or unset) #when started #then there is no signal", () => {
    expect(startForegroundHandoffTimer(0).signal).toBeUndefined()
    expect(startForegroundHandoffTimer(undefined).signal).toBeUndefined()
  })

  test("#given a threshold #when it elapses #then the signal aborts", async () => {
    // given
    const timer = startForegroundHandoffTimer(1)

    // when
    await new Promise<void>((resolve) => timer.signal?.addEventListener("abort", () => resolve(), { once: true }))

    // then
    expect(timer.signal?.aborted).toBe(true)
  })
})

describe("pollSyncSession handoff", () => {
  test("#given the handoff signal has fired #when polling #then it returns the handoff marker without aborting the child", async () => {
    // given
    const abortCalls: string[] = []
    const client = unsafeTestValue({
      session: {
        abort: async (input: { path: { id: string } }) => {
          abortCalls.push(input.path.id)
          return {}
        },
        status: async () => ({ data: { ses_child: { type: "busy" } } }),
        messages: async () => ({ data: [] }),
      },
    })
    const controller = new AbortController()
    controller.abort()

    // when
    const result = await pollSyncSession(
      unsafeTestValue({
        sessionID: "ses_parent",
        messageID: "msg",
        agent: "sisyphus",
        abort: new AbortController().signal,
      }),
      client,
      {
        sessionID: "ses_child",
        agentToUse: "explore",
        toastManager: null,
        taskId: undefined,
        handoffSignal: controller.signal,
      },
      60_000,
    )

    // then
    expect(result).toBe(SYNC_POLL_HANDED_OFF)
    expect(abortCalls).toEqual([])
  })
})
