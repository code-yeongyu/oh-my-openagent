/// <reference path="../../../../bun-test.d.ts" />
import { describe, expect, it } from "bun:test"

import { createUserAbortInterruptedRecoveryGuard } from "./user-abort-interrupted-recovery-guard"

describe("createUserAbortInterruptedRecoveryGuard", () => {
  it("#given a MessageAbortedError is noted #when recovery skip is checked twice #then it skips once", () => {
    // given
    const guard = createUserAbortInterruptedRecoveryGuard()
    const sessionID = "ses_message_abort_once"

    // when
    const noted = guard.noteSessionError(sessionID, "MessageAbortedError")
    const firstSkip = guard.shouldSkipRecovery(sessionID)
    const secondSkip = guard.shouldSkipRecovery(sessionID)

    // then
    expect(noted).toBe(true)
    expect(firstSkip).toBe(true)
    expect(secondSkip).toBe(false)
  })

  it("#given an AbortError skip was already consumed #when later recovery is checked #then it is not suppressed", () => {
    // given
    const guard = createUserAbortInterruptedRecoveryGuard()
    const sessionID = "ses_abort_non_sticky"
    guard.noteSessionError(sessionID, "AbortError")

    // when
    const consumedSkip = guard.shouldSkipRecovery(sessionID)
    const subsequentRecovery = guard.shouldSkipRecovery(sessionID)

    // then
    expect(consumedSkip).toBe(true)
    expect(subsequentRecovery).toBe(false)
  })

  it("#given a non-abort error is noted #when recovery skip is checked #then recovery is not suppressed", () => {
    // given
    const guard = createUserAbortInterruptedRecoveryGuard()
    const sessionID = "ses_non_abort_error"

    // when
    const noted = guard.noteSessionError(sessionID, "ProviderTimeoutError")
    const skipRecovery = guard.shouldSkipRecovery(sessionID)

    // then
    expect(noted).toBe(false)
    expect(skipRecovery).toBe(false)
  })
})
