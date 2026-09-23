/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { resolveModelProfile } from "./resolve"

const OPUS = "anthropic/claude-opus-5-5"
const OPUS_SUBSCRIPTION = "anthropic-subscription/claude-opus-5-5"
const OPUS_ZEN = "opencode/claude-opus-5-5"
const OPUS_API = "anthropic-api/claude-opus-5-5"
const FABLE = "anthropic-subscription/claude-fable-5-1"
const FABLE_ZEN = "opencode/claude-fable-5-1"
const KIMI = "moonshotai/kimi-k3"
const FLASH = "deepseek/deepseek-flash"
const LUNA = "openai/gpt-5.6-luna-fast"
const SOL_FAST = "chatgpt-subscription/gpt-6-sol-fast"
const SOL_COPILOT = "github-copilot/gpt-6-sol"
const ASTRA = "chatgpt-subscription/gpt-6-astra"

const DAILY_NORMAL = {
  id: "daily-normal",
  displayName: "Daily · Normal",
  source: "builtin" as const,
  family: "daily" as const,
  tier: "normal" as const,
}

describe("resolveModelProfile", () => {
  it("picks the first rung the registry can serve and names the skipped ones", () => {
    const result = resolveModelProfile({ active: "daily-normal", availableModels: [KIMI, FLASH] })

    expect(result).toEqual({
      kind: "resolved",
      profile: DAILY_NORMAL,
      provider: "moonshotai",
      modelId: "kimi-k3",
      reasoning: "max",
      skipped: [OPUS_SUBSCRIPTION],
    })
  })

  it("resolves a rung through its second provider when the first is absent", () => {
    const result = resolveModelProfile({ active: "daily-normal", availableModels: [OPUS_API] })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "anthropic-api",
      modelId: "claude-opus-5-5",
      skipped: [],
    })
  })

  it("treats a value carrying a slash as a literal pin", () => {
    const result = resolveModelProfile({ active: OPUS, availableModels: [FABLE, OPUS] })

    expect(result).toEqual({
      kind: "resolved",
      profile: { id: OPUS, displayName: OPUS, source: "pin" },
      provider: "anthropic",
      modelId: "claude-opus-5-5",
      skipped: [],
    })
  })

  it("reports a pin the registry cannot serve as unavailable", () => {
    const result = resolveModelProfile({ active: OPUS, availableModels: [FLASH] })

    expect(result).toEqual({ kind: "unavailable", profile: { id: OPUS, displayName: OPUS, source: "pin" }, chain: [OPUS] })
  })

  it("lets a user entry replace a builtin of the same name wholesale", () => {
    const result = resolveModelProfile({
      profiles: { "daily-normal": { models: [FLASH] } },
      active: "daily-normal",
      availableModels: [OPUS_SUBSCRIPTION, FLASH],
    })

    expect(result).toEqual({
      kind: "resolved",
      profile: { id: "daily-normal", displayName: "Daily · Normal", source: "user", family: "daily", tier: "normal" },
      provider: "deepseek",
      modelId: "deepseek-flash",
      skipped: [],
    })
  })

  it("reports a label-only override as empty instead of falling back to the builtin chain", () => {
    const result = resolveModelProfile({
      profiles: { "daily-normal": { display_name: "House blend" } },
      active: "daily-normal",
      availableModels: [OPUS_SUBSCRIPTION],
    })

    expect(result).toEqual({
      kind: "empty",
      profile: { id: "daily-normal", displayName: "House blend", source: "user", family: "daily", tier: "normal" },
    })
  })

  it("resolves a profile the user added", () => {
    const result = resolveModelProfile({
      profiles: { "night-shift": { display_name: "Night shift", models: [{ model: "gpt-5.6-luna-fast", reasoning: "low" }] } },
      active: "night-shift",
      availableModels: [LUNA],
    })

    expect(result).toEqual({
      kind: "resolved",
      profile: { id: "night-shift", displayName: "Night shift", source: "user" },
      provider: "openai",
      modelId: "gpt-5.6-luna-fast",
      reasoning: "low",
      skipped: [],
    })
  })

  it("carries a reasoning suffix written on a user chain entry", () => {
    const result = resolveModelProfile({
      profiles: { pair: { models: [`${OPUS}:high`] } },
      active: "pair",
      availableModels: [OPUS],
    })

    expect(result).toMatchObject({ kind: "resolved", provider: "anthropic", modelId: "claude-opus-5-5", reasoning: "high" })
  })

  it("reports an empty registry as unavailable and lists the chain", () => {
    const result = resolveModelProfile({ active: "daily-normal", availableModels: [] })

    expect(result).toEqual({
      kind: "unavailable",
      profile: DAILY_NORMAL,
      chain: [OPUS_SUBSCRIPTION, "kimi-coding/kimi-k3", "zai-coding-plan/glm-5.3"],
    })
  })

  it("reports an unknown name once, with the known profiles sorted", () => {
    const result = resolveModelProfile({
      profiles: { "night-shift": { models: [LUNA] } },
      active: "nope",
      availableModels: [LUNA],
    })

    expect(result).toEqual({
      kind: "unknown",
      name: "nope",
      known: ["daily-heavy", "daily-normal", "geeky-heavy", "geeky-normal", "night-shift"],
      message: 'model_profile "nope" is not defined; known profiles: daily-heavy, daily-normal, geeky-heavy, geeky-normal, night-shift',
    })
  })

  it("reports a blank value as unknown rather than silently doing nothing", () => {
    const result = resolveModelProfile({ active: "   ", availableModels: [LUNA] })

    expect(result).toMatchObject({
      kind: "unknown",
      name: "",
      known: ["daily-heavy", "daily-normal", "geeky-heavy", "geeky-normal"],
    })
  })
})

describe("builtin chain routing", () => {
  it("keeps daily-heavy on the Claude subscription when an OpenCode Zen key serves the same model", () => {
    const result = resolveModelProfile({ active: "daily-heavy", availableModels: [FABLE_ZEN, FABLE] })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "anthropic-subscription",
      modelId: "claude-fable-5-1",
      reasoning: "xhigh",
    })
  })

  it("keeps daily-normal on the Claude subscription when Zen also serves Opus", () => {
    const result = resolveModelProfile({ active: "daily-normal", availableModels: [OPUS_ZEN, OPUS_SUBSCRIPTION] })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "anthropic-subscription",
      modelId: "claude-opus-5-5",
      reasoning: "medium",
    })
  })

  it("reports the removed capable, deep-work and simple-work ids as unknown", () => {
    const available = [OPUS_SUBSCRIPTION, ASTRA]
    for (const name of ["capable", "deep-work", "simple-work"] as const) {
      const result = resolveModelProfile({ active: name, availableModels: available })
      expect(result).toMatchObject({
        kind: "unknown",
        name,
        known: ["daily-heavy", "daily-normal", "geeky-heavy", "geeky-normal"],
      })
    }
  })

  it("resolves geeky-normal to gpt-6-sol medium when only Copilot Sol is present", () => {
    const result = resolveModelProfile({ active: "geeky-normal", availableModels: [SOL_COPILOT] })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "github-copilot",
      modelId: "gpt-6-sol",
      reasoning: "medium",
    })
  })

  it("prefers chatgpt-subscription sol-fast over Copilot sol for geeky-normal", () => {
    const result = resolveModelProfile({
      active: "geeky-normal",
      availableModels: [SOL_COPILOT, SOL_FAST],
    })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "chatgpt-subscription",
      modelId: "gpt-6-sol-fast",
      reasoning: "medium",
    })
  })

  it("ranks the openai API lane ahead of an unlisted provider serving geeky-normal sol-fast", () => {
    const result = resolveModelProfile({
      active: "geeky-normal",
      availableModels: ["office-gateway/gpt-6-sol-fast", "openai/gpt-6-sol-fast"],
    })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "openai",
      modelId: "gpt-6-sol-fast",
      reasoning: "medium",
    })
  })

  it("keeps the ChatGPT subscription ahead of the openai API lane for geeky-heavy astra", () => {
    const result = resolveModelProfile({
      active: "geeky-heavy",
      availableModels: ["openai/gpt-6-astra", ASTRA],
    })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "chatgpt-subscription",
      modelId: "gpt-6-astra",
      reasoning: "xhigh",
    })
  })

  it("resolves geeky-heavy to astra xhigh", () => {
    const result = resolveModelProfile({ active: "geeky-heavy", availableModels: [ASTRA, SOL_FAST] })

    expect(result).toMatchObject({
      kind: "resolved",
      modelId: "gpt-6-astra",
      reasoning: "xhigh",
    })
  })

  it("does not silently take another provider when a user overlay names openai and openai is absent", () => {
    const result = resolveModelProfile({
      profiles: { "geeky-normal": { models: [{ model: "openai/gpt-6-sol", reasoning: "medium" }] } },
      active: "geeky-normal",
      availableModels: ["chatgpt-subscription/gpt-6-sol"],
    })

    expect(result).toMatchObject({ kind: "unavailable" })
  })

  it("walks only the user-listed providers when the first scoped rung is missing", () => {
    const result = resolveModelProfile({
      profiles: {
        "geeky-normal": {
          models: [
            { model: "openai/gpt-6-sol", reasoning: "high" },
            { model: "github-copilot/gpt-6-sol", reasoning: "medium" },
          ],
        },
      },
      active: "geeky-normal",
      availableModels: [SOL_COPILOT, SOL_FAST],
    })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "github-copilot",
      modelId: "gpt-6-sol",
      reasoning: "medium",
    })
  })

  it("still matches an unscoped user model through whichever registry provider serves it", () => {
    const result = resolveModelProfile({
      profiles: { "geeky-normal": { models: [{ model: "gpt-6-sol", reasoning: "medium" }] } },
      active: "geeky-normal",
      availableModels: ["chatgpt-subscription/gpt-6-sol"],
    })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "chatgpt-subscription",
      modelId: "gpt-6-sol",
      reasoning: "medium",
    })
  })

  it("selects the named provider when a scoped user rung is present", () => {
    const result = resolveModelProfile({
      profiles: { "geeky-normal": { models: [{ model: "openai/gpt-6-sol", reasoning: "high" }] } },
      active: "geeky-normal",
      availableModels: ["openai/gpt-6-sol", "chatgpt-subscription/gpt-6-sol"],
    })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "openai",
      modelId: "gpt-6-sol",
      reasoning: "high",
    })
  })

  it("keeps geeky-normal family/tier when a user replaces the chain with an openai model and does not merge builtin rungs", () => {
    const result = resolveModelProfile({
      profiles: { "geeky-normal": { models: [{ model: "openai/gpt-6-sol", reasoning: "high" }] } },
      active: "geeky-normal",
      availableModels: [SOL_FAST, "openai/gpt-6-sol"],
    })

    expect(result).toEqual({
      kind: "resolved",
      profile: { id: "geeky-normal", displayName: "Geeky · Normal", source: "user", family: "geeky", tier: "normal" },
      provider: "openai",
      modelId: "gpt-6-sol",
      reasoning: "high",
      skipped: [],
    })
  })
})
