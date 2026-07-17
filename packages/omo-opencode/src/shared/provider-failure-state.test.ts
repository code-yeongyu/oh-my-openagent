import { describe, test, expect, beforeEach } from "bun:test"
import {
  markProviderFailed,
  isProviderFailed,
  clearProviderFailure,
  clearAllProviderFailures,
  getFailedProviders,
  setProviderFailureCooldownMs,
} from "./provider-failure-state"

describe("provider-failure-state", () => {
  beforeEach(() => {
    clearAllProviderFailures()
    setProviderFailureCooldownMs(120_000)
  })

  test("#given no failures #when checking provider #then returns false", () => {
    expect(isProviderFailed("openai")).toBe(false)
  })

  test("#given provider marked failed #when checking immediately #then returns true", () => {
    markProviderFailed("openai")
    expect(isProviderFailed("openai")).toBe(true)
    expect(isProviderFailed("OPENAI")).toBe(true) // case-insensitive
  })

  test("#given provider marked failed #when cooldown expires #then returns false", async () => {
    setProviderFailureCooldownMs(50)
    markProviderFailed("openai")
    expect(isProviderFailed("openai")).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(isProviderFailed("openai")).toBe(false)
  })

  test("#given expired entry #when getFailedProviders called #then excludes expired", async () => {
    setProviderFailureCooldownMs(50)
    markProviderFailed("openai")
    markProviderFailed("anthropic")

    await new Promise((resolve) => setTimeout(resolve, 60))

    // Re-mark anthropic to keep it active
    markProviderFailed("anthropic")

    expect(getFailedProviders()).toEqual(["anthropic"])
  })

  test("#given multiple failures #when clearProviderFailure called #then only clears specific provider", () => {
    markProviderFailed("openai")
    markProviderFailed("anthropic")

    clearProviderFailure("openai")

    expect(isProviderFailed("openai")).toBe(false)
    expect(isProviderFailed("anthropic")).toBe(true)
  })

  test("#given multiple failures #when clearAllProviderFailures called #then all cleared", () => {
    markProviderFailed("openai")
    markProviderFailed("anthropic")

    clearAllProviderFailures()

    expect(isProviderFailed("openai")).toBe(false)
    expect(isProviderFailed("anthropic")).toBe(false)
    expect(getFailedProviders()).toEqual([])
  })

  test("#given provider failed #when getFailedProviders called #then returns active providers", () => {
    markProviderFailed("openai")
    markProviderFailed("anthropic")

    const failed = getFailedProviders()

    expect(failed).toContain("openai")
    expect(failed).toContain("anthropic")
    expect(failed).toHaveLength(2)
  })

  test("#given expired entry #when isProviderFailed called #then cleans up expired entry", async () => {
    setProviderFailureCooldownMs(50)
    markProviderFailed("openai")

    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(isProviderFailed("openai")).toBe(false)
    expect(getFailedProviders()).toEqual([])
  })
})
