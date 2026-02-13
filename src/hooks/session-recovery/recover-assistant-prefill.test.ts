import { describe, expect, test, beforeEach } from "bun:test"
import {
  canAttemptPrefillRecovery,
  markPrefillRecoveryAttempted,
  clearPrefillRecoveryState,
} from "./recover-assistant-prefill"

describe("prefill recovery cooldown", () => {
  beforeEach(() => {
    clearPrefillRecoveryState("test-session-1")
    clearPrefillRecoveryState("test-session-2")
  })

  test("should allow first recovery attempt", () => {
    //#given - no previous recovery attempt
    //#when - checking if recovery can be attempted
    const result = canAttemptPrefillRecovery("test-session-1")

    //#then - should allow recovery
    expect(result).toBe(true)
  })

  test("should block second recovery attempt within cooldown", () => {
    //#given - first recovery was already attempted
    markPrefillRecoveryAttempted("test-session-1")

    //#when - checking if recovery can be attempted again
    const result = canAttemptPrefillRecovery("test-session-1")

    //#then - should block recovery (within 60s cooldown)
    expect(result).toBe(false)
  })

  test("should track sessions independently", () => {
    //#given - recovery attempted on session-1 only
    markPrefillRecoveryAttempted("test-session-1")

    //#when - checking session-2
    const result = canAttemptPrefillRecovery("test-session-2")

    //#then - session-2 should still allow recovery
    expect(result).toBe(true)
  })

  test("should allow recovery after clearing state", () => {
    //#given - recovery was attempted then cleared
    markPrefillRecoveryAttempted("test-session-1")
    clearPrefillRecoveryState("test-session-1")

    //#when - checking if recovery can be attempted
    const result = canAttemptPrefillRecovery("test-session-1")

    //#then - should allow recovery again
    expect(result).toBe(true)
  })
})
