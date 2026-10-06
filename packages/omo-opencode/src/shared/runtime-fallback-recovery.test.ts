import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  _resetRuntimeFallbackRecoveryForTesting,
  awaitRuntimeFallbackRecoveryDecision,
  openRuntimeFallbackRecoveryClaim,
  registerRuntimeFallbackRecoveryOwner,
  settleRuntimeFallbackRecoveryClaim,
} from "./runtime-fallback-recovery"

describe("runtime-fallback recovery claims", () => {
  beforeEach(() => {
    _resetRuntimeFallbackRecoveryForTesting()
  })

  afterEach(() => {
    _resetRuntimeFallbackRecoveryForTesting()
  })

  test("opens no claim while no runtime-fallback owner is registered", () => {
    // given
    const event = { type: "session.error" }

    // when
    openRuntimeFallbackRecoveryClaim(event, "ses_1")

    // then
    expect(awaitRuntimeFallbackRecoveryDecision(event)).toBeUndefined()
  })

  test("holds the waiter until the owner settles, then resolves with its decision", async () => {
    // given
    registerRuntimeFallbackRecoveryOwner()
    const event = { type: "session.error" }
    openRuntimeFallbackRecoveryClaim(event, "ses_1")
    let resolved: string | undefined

    // when
    const pending = awaitRuntimeFallbackRecoveryDecision(event)
    pending?.then((decision) => { resolved = decision })
    await Promise.resolve()
    const resolvedBeforeSettle = resolved
    settleRuntimeFallbackRecoveryClaim(event, "retry-owned")

    // then
    expect(resolvedBeforeSettle).toBeUndefined()
    expect(await pending).toBe("retry-owned")
  })

  test("returns the decision immediately when it was settled before the waiter arrived", async () => {
    // given
    registerRuntimeFallbackRecoveryOwner()
    const event = { type: "session.error" }
    openRuntimeFallbackRecoveryClaim(event, "ses_1")
    settleRuntimeFallbackRecoveryClaim(event, "declined")

    // when
    const decision = await awaitRuntimeFallbackRecoveryDecision(event)

    // then
    expect(decision).toBe("declined")
  })

  test("keeps claims for two errors on the same session independent", async () => {
    // given
    registerRuntimeFallbackRecoveryOwner()
    const staleError = { type: "session.error" }
    const retryError = { type: "session.error" }
    openRuntimeFallbackRecoveryClaim(staleError, "ses_1")
    openRuntimeFallbackRecoveryClaim(retryError, "ses_1")

    // when
    settleRuntimeFallbackRecoveryClaim(staleError, "retry-owned")
    settleRuntimeFallbackRecoveryClaim(retryError, "declined")

    // then
    expect(await awaitRuntimeFallbackRecoveryDecision(staleError)).toBe("retry-owned")
    expect(await awaitRuntimeFallbackRecoveryDecision(retryError)).toBe("declined")
  })

  test("keeps the first decision when a claim is settled twice", async () => {
    // given
    registerRuntimeFallbackRecoveryOwner()
    const event = { type: "session.error" }
    openRuntimeFallbackRecoveryClaim(event, "ses_1")

    // when
    settleRuntimeFallbackRecoveryClaim(event, "retry-owned")
    settleRuntimeFallbackRecoveryClaim(event, "declined")

    // then
    expect(await awaitRuntimeFallbackRecoveryDecision(event)).toBe("retry-owned")
  })

  test("resolves as declined when the owner never settles", async () => {
    // given
    registerRuntimeFallbackRecoveryOwner()
    const event = { type: "session.error" }
    openRuntimeFallbackRecoveryClaim(event, "ses_1")

    // when
    const decision = await awaitRuntimeFallbackRecoveryDecision(event, 10)

    // then
    expect(decision).toBe("declined")
  })

  test("stops opening claims once the last owner is released", () => {
    // given
    const release = registerRuntimeFallbackRecoveryOwner()
    release()
    release()
    const event = { type: "session.error" }

    // when
    openRuntimeFallbackRecoveryClaim(event, "ses_1")

    // then
    expect(awaitRuntimeFallbackRecoveryDecision(event)).toBeUndefined()
  })
})
