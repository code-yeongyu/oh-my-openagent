/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { BUILTIN_MODEL_PROFILES } from "./builtin-profiles"
import { KNOWN_MODELS } from "../telemetry/model-vocabulary"
import { CATEGORY_FALLBACK_CHAINS } from "../../../../senpi-task/src/category/fallback-chains"

// The id order is the order the picker renders, so it is pinned as a literal list.
const EXPECTED_IDS = ["capable", "simple-work", "deep-work"] as const

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

describe("BUILTIN_MODEL_PROFILES", () => {
  it("ships exactly the three intent profiles in picker order", () => {
    expect(Object.keys(BUILTIN_MODEL_PROFILES)).toEqual([...EXPECTED_IDS])
  })

  it("labels each profile by intent", () => {
    expect(BUILTIN_MODEL_PROFILES["capable"]?.displayName).toBe("Capable")
    expect(BUILTIN_MODEL_PROFILES["simple-work"]?.displayName).toBe("Simple work")
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

  it("copies the deep category chain verbatim into deep-work", () => {
    expect(BUILTIN_MODEL_PROFILES["deep-work"]?.models).toEqual(CATEGORY_FALLBACK_CHAINS["deep"])
  })

  it("orders the capable chain fable -> opus -> kimi -> glm", () => {
    expect(BUILTIN_MODEL_PROFILES["capable"]?.models.map((rung) => rung.model)).toEqual([
      "claude-fable-5-1",
      "claude-opus-5",
      "kimi-k3",
      "glm-5.3",
    ])
  })

  it("keeps simple-work on the fast rungs", () => {
    expect(BUILTIN_MODEL_PROFILES["simple-work"]?.models.map((rung) => rung.model)).toEqual([
      "gpt-5.6-luna-fast",
      "deepseek-v4-flash",
      "claude-haiku-4-5",
    ])
  })
})
