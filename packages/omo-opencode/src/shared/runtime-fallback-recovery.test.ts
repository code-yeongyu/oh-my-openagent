import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import {
  _resetRuntimeFallbackRecoveryForTesting,
  awaitLateRuntimeFallbackRecoveryDecision,
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

  test("timeout does not authorize competing recovery while the hook is still pending", async () => {
    // given
    registerRuntimeFallbackRecoveryOwner()
    const event = { type: "session.error" }
    openRuntimeFallbackRecoveryClaim(event, "ses_1")

    // when
    let fireTimeout: (() => void) | undefined
    const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: Parameters<typeof setTimeout>[0]) => {
      fireTimeout = callback as () => void
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)
    const pending = awaitRuntimeFallbackRecoveryDecision(event)
    fireTimeout?.()
    timer.mockRestore()
    const decision = await pending

    // then
    expect(decision).toBe("timed-out")
    settleRuntimeFallbackRecoveryClaim(event, "retry-owned")
    expect(await awaitRuntimeFallbackRecoveryDecision(event)).toBe("retry-owned")
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
  test("#given an open claim #when the last owner is released before settling #then every waiter gets declined", async () => {
    // given
    const release = registerRuntimeFallbackRecoveryOwner()
    const event = { type: "session.error" }
    openRuntimeFallbackRecoveryClaim(event, "ses_1")
    const pending = awaitRuntimeFallbackRecoveryDecision(event)

    // when
    release()

    // then
    expect(await pending).toBe("declined")
  })

  test("#given a claim another owner still holds #when one owner is released #then the claim stays open", async () => {
    // given
    registerRuntimeFallbackRecoveryOwner()
    const release = registerRuntimeFallbackRecoveryOwner()
    const event = { type: "session.error" }
    openRuntimeFallbackRecoveryClaim(event, "ses_1")
    let settled: string | undefined
    awaitLateRuntimeFallbackRecoveryDecision(event)?.then((decision) => { settled = decision })

    // when
    release()
    await Promise.resolve()

    // then
    expect(settled).toBeUndefined()
    settleRuntimeFallbackRecoveryClaim(event, "retry-owned")
  })

  test("#given a waiter that timed out #when the owner declines later #then the late waiter receives declined", async () => {
    // given
    registerRuntimeFallbackRecoveryOwner()
    const event = { type: "session.error" }
    openRuntimeFallbackRecoveryClaim(event, "ses_1")
    let fireTimeout: (() => void) | undefined
    const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: Parameters<typeof setTimeout>[0]) => {
      fireTimeout = callback as () => void
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)
    try {
      const first = awaitRuntimeFallbackRecoveryDecision(event)
      fireTimeout?.()
      expect(await first).toBe("timed-out")
      const late = awaitLateRuntimeFallbackRecoveryDecision(event)

      // when
      settleRuntimeFallbackRecoveryClaim(event, "declined")

      // then
      expect(await late).toBe("declined")
    } finally {
      timer.mockRestore()
    }
  })
})
