/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { BUILTIN_MODEL_PROFILES, DEFAULT_MODEL_PROFILE_ID } from "./builtin-profiles"
import { KNOWN_MODELS } from "../telemetry/model-vocabulary"

const LANE_IDS = ["daily-normal", "daily-heavy", "geeky-normal", "geeky-heavy"] as const
const EXPECTED_IDS = ["recommended", ...LANE_IDS] as const

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
  it("ships the recommended default then the four lane profiles in picker order", () => {
    expect(Object.keys(BUILTIN_MODEL_PROFILES)).toEqual([...EXPECTED_IDS])
  })

  it("labels each profile by lane and gives every profile a distinct family/tier pair", () => {
    expect(BUILTIN_MODEL_PROFILES["daily-normal"]?.displayName).toBe("Daily · Normal")
    expect(BUILTIN_MODEL_PROFILES["daily-heavy"]?.displayName).toBe("Daily · Heavy")
    expect(BUILTIN_MODEL_PROFILES["geeky-normal"]?.displayName).toBe("Geeky · Normal")
    expect(BUILTIN_MODEL_PROFILES["geeky-heavy"]?.displayName).toBe("Geeky · Heavy")
    const pairs = LANE_IDS.map((id) => `${BUILTIN_MODEL_PROFILES[id]?.family}:${BUILTIN_MODEL_PROFILES[id]?.tier}`)
    expect(pairs).toEqual(["daily:normal", "daily:heavy", "geeky:normal", "geeky:heavy"])
    for (const id of EXPECTED_IDS) {
      expect(BUILTIN_MODEL_PROFILES[id]?.description.length ?? 0).toBeGreaterThan(0)
    }
  })

  it("uses recommended, which is not a lane, as the unset-config default id", () => {
    expect(DEFAULT_MODEL_PROFILE_ID).toBe("recommended")
    const recommended = BUILTIN_MODEL_PROFILES[DEFAULT_MODEL_PROFILE_ID]
    expect(recommended?.displayName).toBe("Recommended")
    expect(recommended?.family).toBeUndefined()
    expect(recommended?.tier).toBeUndefined()
  })

  // Mirrors senpi's RECOMMENDED_DEFAULT_MODELS (recommended-models/index.ts, senpi#2074; GPT-6.1 Sol
  // from senpi#2394), so the TUI and the desktop start from one order. Change both together. OmO adds
  // the gpt-6-sol medium rung behind gpt-6.1-sol for the GPT lanes that do not serve 6.1 Sol.
  it("orders recommended opus medium, fable xhigh, kimi max, astra xhigh, 6.1 sol medium, 6 sol medium, glm max", () => {
    expect(chainOf("recommended")).toEqual([
      "claude-opus-5-5 medium",
      "claude-fable-5-1 xhigh",
      "kimi-k3 max",
      "gpt-6-astra xhigh",
      "gpt-6.1-sol medium",
      "gpt-6-sol medium",
      "glm-5.3 max",
    ])
  })

  it("serves recommended's gpt-6.1-sol rung on the OpenAI lanes and its gpt-6-sol rung on every GPT lane", () => {
    const sol = (BUILTIN_MODEL_PROFILES["recommended"]?.models ?? []).filter((rung) => rung.model.includes("-sol"))
    expect(sol).toEqual([
      { providers: ["chatgpt-subscription", "openai"], model: "gpt-6.1-sol", variant: "medium" },
      { providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"], model: "gpt-6-sol", variant: "medium" },
    ])
  })

  it("never lists a gateway aggregator on a recommended rung", () => {
    const gateways = ["opengateway", "openrouter", "vercel-ai-gateway", "cloudflare-ai-gateway"]
    const offenders = (BUILTIN_MODEL_PROFILES["recommended"]?.models ?? []).flatMap((rung) =>
      rung.providers.filter((provider) => gateways.includes(provider)),
    )
    expect(offenders).toEqual([])
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

  it("ranks the ChatGPT subscription ahead of the openai API lane on every GPT rung", () => {
    const gptRungs = rungs().filter((rung) => rung.model.startsWith("gpt-"))
    expect(gptRungs.length).toBeGreaterThan(0)
    const misordered = gptRungs
      .filter((rung) => rung.providers[0] !== "chatgpt-subscription" || rung.providers[1] !== "openai")
      .map((rung) => `${rung.profile}: ${rung.providers.join("|")}/${rung.model}`)
    expect(misordered).toEqual([])
  })

  it("heads every GLM rung with engine zai then zai-coding-cn", () => {
    const glmRungs = rungs().filter((rung) => rung.model.startsWith("glm-"))
    expect(glmRungs.length).toBeGreaterThan(0)
    const misordered = glmRungs
      .filter((rung) => rung.providers[0] !== "zai" || rung.providers[1] !== "zai-coding-cn")
      .map((rung) => `${rung.profile}: ${rung.providers.join("|")}/${rung.model}`)
    expect(misordered).toEqual([])
  })

  it("heads every Claude rung with the anthropic-subscription lane", () => {
    const claudeRungs = rungs().filter((rung) => rung.model.startsWith("claude-"))
    expect(claudeRungs.length).toBeGreaterThan(0)
    expect(claudeRungs.filter((rung) => rung.providers[0] !== "anthropic-subscription").map((rung) => `${rung.profile}: ${rung.model}`)).toEqual([])
  })

  it("orders daily-normal opus medium then kimi max then glm max", () => {
    expect(chainOf("daily-normal")).toEqual(["claude-opus-5-5 medium", "kimi-k3 max", "glm-5.3 max"])
  })

  it("runs daily-heavy as fable xhigh only", () => {
    expect(BUILTIN_MODEL_PROFILES["daily-heavy"]?.models).toEqual([
      {
        providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "xhigh",
      },
    ])
  })

  it("runs geeky-normal as gpt-6.1-sol-fast then gpt-6.1-sol medium on the OpenAI lanes, then gpt-5.6-sol medium on every GPT lane", () => {
    expect(BUILTIN_MODEL_PROFILES["geeky-normal"]?.models).toEqual([
      { providers: ["chatgpt-subscription", "openai"], model: "gpt-6.1-sol-fast", variant: "medium" },
      { providers: ["chatgpt-subscription", "openai"], model: "gpt-6.1-sol", variant: "medium" },
      { providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"], model: "gpt-5.6-sol", variant: "medium" },
    ])
  })

  it("runs geeky-heavy as astra high with the same provider ranking as deep-high", () => {
    expect(BUILTIN_MODEL_PROFILES["geeky-heavy"]?.models).toEqual([
      {
        providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"],
        model: "gpt-6-astra",
        variant: "high",
      },
    ])
  })
})
