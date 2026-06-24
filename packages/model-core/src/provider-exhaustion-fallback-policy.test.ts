import { describe, expect, test } from "bun:test"

import {
  classifyProviderExhaustionFallbackSignal,
  isProviderExhaustionFallbackEligible,
} from "./provider-exhaustion-fallback-policy"
import { shouldRetryError } from "./model-error-classifier"

describe("provider exhaustion fallback policy", () => {
  test("#given quota subscription and billing exhaustion #when checked for provider fallback #then they are eligible without weakening legacy stop semantics", () => {
    //#given
    const errors = [
      { name: "QuotaExceededError", message: "Quota exceeded for this billing period." },
      { message: "Subscription limit exceeded. You can continue using free models." },
      { name: "BillingError", message: "Billing hard limit reached for this account." },
      { message: "Payment required: out of credits." },
      { message: "Credit balance too low for this request." },
    ] as const

    //#when
    const providerExhaustionResults = errors.map((error) => ({
      signal: classifyProviderExhaustionFallbackSignal(error),
      eligible: isProviderExhaustionFallbackEligible(error),
    }))
    const legacyRetryResults = errors.map((error) => shouldRetryError(error))

    //#then
    expect(providerExhaustionResults).toEqual(
      errors.map(() => ({ signal: "quota_exceeded", eligible: true })),
    )
    expect(legacyRetryResults).toEqual(errors.map(() => false))
  })

  test("#given hard-stop runtime errors #when checked for provider exhaustion fallback #then they stay ineligible", () => {
    //#given
    const hardStopErrors = [
      { name: "MessageAbortedError", message: "The user aborted this request." },
      {
        name: "AI_LoadAPIKeyError",
        message: "API key is missing from the OPENAI_API_KEY environment variable.",
      },
      { message: "API key must be a string." },
      { name: "ValidationError", message: "Invalid request payload." },
    ] as const

    //#when
    const results = hardStopErrors.map((error) => ({
      signal: classifyProviderExhaustionFallbackSignal(error),
      eligible: isProviderExhaustionFallbackEligible(error),
    }))

    //#then
    expect(results).toEqual(
      hardStopErrors.map(() => ({ signal: undefined, eligible: false })),
    )
  })
})
