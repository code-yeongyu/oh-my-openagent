/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { resolveModelProfile } from "./resolve"

const FABLE = "anthropic-subscription/claude-fable-5-1"
const FABLE_ZEN = "opencode/claude-fable-5-1"
const FABLE_API = "anthropic-api/claude-fable-5-1"
const OPUS = "anthropic/claude-opus-5-5"
const OPUS_SUBSCRIPTION = "anthropic-subscription/claude-opus-5-5"
const KIMI = "moonshotai/kimi-k3"
const FLASH = "deepseek/deepseek-v4-flash"
const LUNA = "openai/gpt-5.6-luna-fast"

describe("resolveModelProfile", () => {
  it("picks the first rung the registry can serve and names the skipped ones", () => {
    const result = resolveModelProfile({ active: "capable", availableModels: [KIMI, FLASH] })

    expect(result).toEqual({
      kind: "resolved",
      profile: { id: "capable", displayName: "Capable", source: "builtin" },
      provider: "moonshotai",
      modelId: "kimi-k3",
      reasoning: "max",
      skipped: [FABLE, OPUS_SUBSCRIPTION],
    })
  })

  it("resolves a rung through its second provider when the first is absent", () => {
    const result = resolveModelProfile({ active: "capable", availableModels: [FABLE_API] })

    expect(result).toMatchObject({
      kind: "resolved",
      provider: "anthropic-api",
      modelId: "claude-fable-5-1",
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
      profiles: { capable: { models: [FLASH] } },
      active: "capable",
      availableModels: [FABLE, FLASH],
    })

    expect(result).toEqual({
      kind: "resolved",
      profile: { id: "capable", displayName: "capable", source: "user" },
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      skipped: [],
    })
  })

  it("reports a label-only override as empty instead of falling back to the builtin chain", () => {
    const result = resolveModelProfile({
      profiles: { capable: { display_name: "House blend" } },
      active: "capable",
      availableModels: [FABLE],
    })

    expect(result).toEqual({ kind: "empty", profile: { id: "capable", displayName: "House blend", source: "user" } })
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
    const result = resolveModelProfile({ active: "capable", availableModels: [] })

    expect(result).toEqual({
      kind: "unavailable",
      profile: { id: "capable", displayName: "Capable", source: "builtin" },
      chain: [FABLE, OPUS_SUBSCRIPTION, "kimi-coding/kimi-k3", "zai-coding-plan/glm-5.3"],
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
      known: ["capable", "deep-work", "night-shift"],
      message: 'model_profile "nope" is not defined; known profiles: capable, deep-work, night-shift',
    })
  })

  it("reports a blank value as unknown rather than silently doing nothing", () => {
    const result = resolveModelProfile({ active: "   ", availableModels: [LUNA] })

    expect(result).toMatchObject({ kind: "unknown", name: "", known: ["capable", "deep-work"] })
  })
})

describe("builtin chain routing", () => {
  it("keeps capable on the Claude subscription when an OpenCode Zen key serves the same model", () => {
    const result = resolveModelProfile({ active: "capable", availableModels: [FABLE_ZEN, FABLE] })

    expect(result).toMatchObject({ kind: "resolved", provider: "anthropic-subscription", modelId: "claude-fable-5-1", reasoning: "xhigh" })
  })

  it("reports the removed simple-work profile as unknown instead of resolving it", () => {
    const result = resolveModelProfile({ active: "simple-work", availableModels: ["chatgpt-subscription/gpt-6-luna-fast"] })

    expect(result).toMatchObject({ kind: "unknown", name: "simple-work", known: ["capable", "deep-work"] })
  })

  it("stops deep-work after GPT-6 Sol instead of falling to GPT-5.6 Sol", () => {
    const sol = resolveModelProfile({ active: "deep-work", availableModels: ["chatgpt-subscription/gpt-6-sol"] })
    const onlyOldSol = resolveModelProfile({ active: "deep-work", availableModels: ["chatgpt-subscription/gpt-5.6-sol"] })

    expect(sol).toMatchObject({ kind: "resolved", modelId: "gpt-6-sol", reasoning: "medium" })
    expect(onlyOldSol).toMatchObject({ kind: "unavailable" })
  })
})
