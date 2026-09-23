/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { BUILTIN_MODEL_PROFILES } from "./builtin-profiles"
import { KNOWN_MODELS } from "../telemetry/model-vocabulary"

// The id order is the order the picker renders, so it is pinned as a literal list.
const EXPECTED_IDS = ["capable", "deep-work"] as const

// The vendors banned from every public omo surface. Their literal spelling is assembled from
// fragments on purpose: the acceptance gate greps this whole directory for those names, so the
// guard that keeps them OUT of the table must not put them back IN as test data.
const BANNED_VENDOR_TOKENS: readonly string[] = [["mini", "max"].join(""), ["gem", "ini"].join("")]

const PROVIDER_VOCABULARY: Readonly<Record<string, readonly string[]>> = KNOWN_MODELS

function rungs(): readonly { readonly profile: string; readonly providers: readonly string[]; readonly model: string }[] {
  return Object.entries(BUILTIN_MODEL_PROFILES).flatMap(([profile, definition]) =>
    definition.models.map((rung) => ({ profile, providers: rung.providers, model: rung.model })),
  )
}

function chainOf(profile: string): readonly string[] {
  return (BUILTIN_MODEL_PROFILES[profile]?.models ?? []).map((rung) => `${rung.model} ${rung.variant ?? "default"}`)
}

describe("BUILTIN_MODEL_PROFILES", () => {
  it("ships exactly the two intent profiles in picker order", () => {
    expect(Object.keys(BUILTIN_MODEL_PROFILES)).toEqual([...EXPECTED_IDS])
  })

  it("labels each profile by intent", () => {
    expect(BUILTIN_MODEL_PROFILES["capable"]?.displayName).toBe("Capable")
    expect(BUILTIN_MODEL_PROFILES["deep-work"]?.displayName).toBe("Deep work")
    for (const id of EXPECTED_IDS) {
      expect(BUILTIN_MODEL_PROFILES[id]?.description.length ?? 0).toBeGreaterThan(0)
    }
  })

  it("gives every rung at least one provider and a model id", () => {
    expect(rungs().length).toBeGreaterThan(0)
    const invalid = rungs()
      .filter((rung) => rung.model.trim().length === 0 || rung.providers.length === 0)
      .map((rung) => `${rung.profile}: ${rung.providers.join("|")}/${rung.model}`)
    expect(invalid).toEqual([])
  })

  it("routes every rung through a provider/model pair the product already knows", () => {
    const unknownPairs = rungs().flatMap((rung) =>
      rung.providers
        .filter((provider) => !(PROVIDER_VOCABULARY[provider] ?? []).includes(rung.model))
        .map((provider) => `${rung.profile}: ${provider}/${rung.model}`),
    )
    expect(unknownPairs).toEqual([])
  })

  it("names no banned vendor", () => {
    const offenders = rungs()
      .flatMap((rung) => [rung.model, ...rung.providers])
      .filter((token) => BANNED_VENDOR_TOKENS.some((banned) => token.toLowerCase().includes(banned)))
    expect(offenders).toEqual([])
  })

  it("lists no rung on the openai API lane so chatgpt-subscription is the only OpenAI lane", () => {
    const apiLaneRungs = rungs()
      .filter((rung) => rung.providers.includes("openai"))
      .map((rung) => `${rung.profile}: ${rung.providers.join("|")}/${rung.model}`)
    expect(apiLaneRungs).toEqual([])
  })

  it("heads every Claude rung with the anthropic-subscription lane", () => {
    const claudeRungs = rungs().filter((rung) => rung.model.startsWith("claude-"))
    expect(claudeRungs.length).toBeGreaterThan(0)
    expect(claudeRungs.filter((rung) => rung.providers[0] !== "anthropic-subscription").map((rung) => `${rung.profile}: ${rung.model}`)).toEqual([])
  })

  it("orders the capable chain fable xhigh -> opus max -> kimi max -> glm max", () => {
    expect(chainOf("capable")).toEqual([
      "claude-fable-5-1 xhigh",
      "claude-opus-5-5 max",
      "kimi-k3 max",
      "glm-5.3 max",
    ])
  })

  it("runs deep-work as astra high then gpt-6-sol medium and nothing after it", () => {
    expect(BUILTIN_MODEL_PROFILES["deep-work"]?.models).toEqual([
      { providers: ["chatgpt-subscription", "github-copilot", "opencode"], model: "gpt-6-astra", variant: "high" },
      { providers: ["chatgpt-subscription", "github-copilot", "opencode"], model: "gpt-6-sol", variant: "medium" },
    ])
  })
})
