import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearAllProviderFailures,
  clearSessionProviderFailures,
  getFailedProviders,
  isProviderFailed,
  markProviderFailed,
  setProviderFailureCooldownMs,
} from "./provider-failure-state"

describe("provider-failure-state", () => {
  beforeEach(() => {
    clearAllProviderFailures()
    setProviderFailureCooldownMs(120_000)
  })

  test("#given no failures #when checking provider #then returns false", () => {
    expect(isProviderFailed("session-a", "openai")).toBe(false)
  })

  test("#given provider marked failed for one session #when another session checks it #then failures do not leak", () => {
    markProviderFailed("session-a", "openai")

    expect(isProviderFailed("session-a", "OPENAI")).toBe(true)
    expect(isProviderFailed("session-b", "openai")).toBe(false)
  })

  test("#given provider marked failed #when cooldown is zero #then returns false without waiting", () => {
    markProviderFailed("session-a", "openai")
    setProviderFailureCooldownMs(0)

    expect(isProviderFailed("session-a", "openai")).toBe(false)
  })

  test("#given failures in two sessions #when one session is cleared #then the other session remains failed", () => {
    markProviderFailed("session-a", "openai")
    markProviderFailed("session-b", "anthropic")

    clearSessionProviderFailures("session-a")

    expect(isProviderFailed("session-a", "openai")).toBe(false)
    expect(isProviderFailed("session-b", "anthropic")).toBe(true)
  })

  test("#given multiple failures #when clearAllProviderFailures called #then all cleared", () => {
    markProviderFailed("session-a", "openai")
    markProviderFailed("session-b", "anthropic")

    clearAllProviderFailures()

    expect(isProviderFailed("session-a", "openai")).toBe(false)
    expect(isProviderFailed("session-b", "anthropic")).toBe(false)
  })

  test("#given provider failed #when getFailedProviders called #then returns active providers", () => {
    markProviderFailed("session-a", "openai")
    markProviderFailed("session-a", "anthropic")

    const failed = getFailedProviders("session-a")

    expect(failed).toContain("openai")
    expect(failed).toContain("anthropic")
    expect(failed).toHaveLength(2)
  })
})
