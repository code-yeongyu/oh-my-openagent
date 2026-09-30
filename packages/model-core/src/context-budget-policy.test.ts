import { describe, expect, it } from "bun:test"
import {
  resolveContextBudgetPolicy,
  type ContextBudgetConfig,
} from "./context-budget-policy"

describe("ContextBudgetPolicy", () => {
  it("resolves 200k model policy with standard defaults", () => {
    const policy = resolveContextBudgetPolicy({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      physicalContextWindow: 200_000,
    })

    expect(policy.physicalContextWindow).toBe(200_000)
    // 200k model should NOT be forced to 384k
    expect(policy.maxActiveContextTokens).toBe(200_000 - policy.reserveTokens)
    expect(policy.keepRecentTokens).toBe(20_000)
    expect(policy.warmupFraction).toBe(0.75)
    expect(policy.targetActiveFraction).toBe(0.60)
  })

  it("resolves 1M model policy with 384k active ceiling and 35k keepRecent", () => {
    const policy = resolveContextBudgetPolicy({
      providerID: "anthropic",
      modelID: "claude-opus-5",
      physicalContextWindow: 1_000_000,
    })

    expect(policy.physicalContextWindow).toBe(1_000_000)
    expect(policy.maxActiveContextTokens).toBe(384_000)
    expect(policy.keepRecentTokens).toBe(35_000)
    expect(policy.warmupFraction).toBe(0.75)
    expect(policy.targetActiveFraction).toBe(0.60)
    expect(Math.round(policy.maxActiveContextTokens * policy.warmupFraction)).toBe(288_000)
  })

  it("respects user overrides over default 1M ceiling and keepRecent", () => {
    const userConfig: ContextBudgetConfig = {
      max_active_context_tokens: 450_000,
      keep_recent_tokens: 40_000,
      warmup_fraction: 0.80,
      target_active_fraction: 0.50,
      reserve_tokens: 20_000,
    }

    const policy = resolveContextBudgetPolicy({
      providerID: "anthropic",
      modelID: "claude-opus-5",
      physicalContextWindow: 1_000_000,
      config: userConfig,
    })

    expect(policy.physicalContextWindow).toBe(1_000_000)
    expect(policy.maxActiveContextTokens).toBe(450_000)
    expect(policy.keepRecentTokens).toBe(40_000)
    expect(policy.warmupFraction).toBe(0.80)
    expect(policy.targetActiveFraction).toBe(0.50)
    expect(policy.reserveTokens).toBe(20_000)
  })

  it("keeps a positive active budget when reserve consumes the physical window", () => {
    const policy = resolveContextBudgetPolicy({
      providerID: "openai",
      modelID: "gpt-4",
      physicalContextWindow: 8_192,
    })

    expect(policy.maxActiveContextTokens).toBe(1)
    expect(policy.reserveTokens).toBe(8_191)
    expect(policy.emergencyHardLimitTokens).toBeGreaterThan(0)
  })

  it("keeps a one-token budget for a one-token physical window", () => {
    const policy = resolveContextBudgetPolicy({
      providerID: "test",
      modelID: "tiny",
      physicalContextWindow: 1,
    })

    expect(policy.maxActiveContextTokens).toBe(1)
    expect(policy.reserveTokens).toBe(0)
  })

  it("clamps an oversized configured reserve below the physical window", () => {
    const policy = resolveContextBudgetPolicy({
      providerID: "openai",
      modelID: "gpt-4o",
      physicalContextWindow: 128_000,
      config: { reserve_tokens: 200_000 },
    })

    expect(policy.maxActiveContextTokens).toBe(1)
    expect(policy.reserveTokens).toBe(127_999)
  })

  it("handles small context models without overflowing ceiling", () => {
    const policy = resolveContextBudgetPolicy({
      providerID: "openai",
      modelID: "gpt-4o",
      physicalContextWindow: 128_000,
    })

    expect(policy.physicalContextWindow).toBe(128_000)
    expect(policy.maxActiveContextTokens).toBe(128_000 - policy.reserveTokens)
    expect(policy.keepRecentTokens).toBe(20_000)
  })
})
