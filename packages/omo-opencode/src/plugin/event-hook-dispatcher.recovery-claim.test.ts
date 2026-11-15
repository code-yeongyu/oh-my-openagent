import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import {
  _resetRuntimeFallbackRecoveryForTesting,
  awaitRuntimeFallbackRecoveryDecision,
  registerRuntimeFallbackRecoveryOwner,
  settleRuntimeFallbackRecoveryClaim,
} from "../shared/runtime-fallback-recovery"
import { createEventHookDispatcher, createEventHookRunner } from "./event-hook-dispatcher"

type Dispatcher = Parameters<typeof createEventHookDispatcher>[0]

describe("event hook dispatcher recovery claim", () => {
  beforeEach(() => {
    _resetRuntimeFallbackRecoveryForTesting()
  })

  afterEach(() => {
    _resetRuntimeFallbackRecoveryForTesting()
  })

  test("opens the claim before the background manager sees the error and before runtime-fallback runs", async () => {
    // given
    registerRuntimeFallbackRecoveryOwner()
    const order: string[] = []
    let managerDecision: ReturnType<typeof awaitRuntimeFallbackRecoveryDecision>
    const dispatch = createEventHookDispatcher(
      unsafeTestValue<Dispatcher>({
        backgroundNotificationHook: {
          event: ({ event }: { event: object }) => {
            managerDecision = awaitRuntimeFallbackRecoveryDecision(event)
            order.push(`background-notification:claim=${managerDecision ? "open" : "none"}`)
          },
        },
        runtimeFallback: {
          event: async ({ event }: { event: object }) => {
            order.push("runtime-fallback")
            settleRuntimeFallbackRecoveryClaim(event, "retry-owned")
          },
        },
      }),
      createEventHookRunner(),
    )

    // when
    await dispatch({ event: { type: "session.error", properties: { sessionID: "ses_dispatch_1" } } })

    // then
    expect(order).toEqual(["background-notification:claim=open", "runtime-fallback"])
    expect(await managerDecision).toBe("retry-owned")
  })

  test("opens no claim for events other than session.error", async () => {
    // given
    registerRuntimeFallbackRecoveryOwner()
    let managerDecision: ReturnType<typeof awaitRuntimeFallbackRecoveryDecision> = Promise.resolve("declined")
    const dispatch = createEventHookDispatcher(
      unsafeTestValue<Dispatcher>({
        backgroundNotificationHook: {
          event: ({ event }: { event: object }) => {
            managerDecision = awaitRuntimeFallbackRecoveryDecision(event)
          },
        },
      }),
      createEventHookRunner(),
    )

    // when
    await dispatch({ event: { type: "session.idle", properties: { sessionID: "ses_dispatch_2" } } })

    // then
    expect(managerDecision).toBeUndefined()
  })

  test("opens no claim when runtime-fallback is not running", async () => {
    // given
    let managerDecision: ReturnType<typeof awaitRuntimeFallbackRecoveryDecision> = Promise.resolve("declined")
    const dispatch = createEventHookDispatcher(
      unsafeTestValue<Dispatcher>({
        backgroundNotificationHook: {
          event: ({ event }: { event: object }) => {
            managerDecision = awaitRuntimeFallbackRecoveryDecision(event)
          },
        },
      }),
      createEventHookRunner(),
    )

    // when
    await dispatch({ event: { type: "session.error", properties: { sessionID: "ses_dispatch_3" } } })

    // then
    expect(managerDecision).toBeUndefined()
  })
})
