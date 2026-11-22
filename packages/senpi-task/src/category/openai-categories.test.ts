/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import { resolveCategory } from "./index"
import {
  DEEP_HIGH_CATEGORY_PROMPT_APPEND,
  DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT,
  DEEP_LOW_CATEGORY_PROMPT_APPEND,
  DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT,
  OPENAI_CATEGORIES,
  ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
  UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
  isGpt6Model,
  resolveDeepHighCategoryPromptAppend,
  resolveDeepLowCategoryPromptAppend,
  resolveUltrabrainCategoryPromptAppend,
  resolveUnspecifiedHighCategoryPromptAppend,
} from "./openai-categories"

type FakeModel = { readonly provider: string; readonly id: string }

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function definition(name: string) {
  const found = OPENAI_CATEGORIES.find((category) => category.name === name)
  if (!found) throw new Error(`missing builtin category ${name}`)
  return found
}

const ASTRA_IDS = [
  "gpt-6-astra",
  "openai/gpt-6-astra",
  "chatgpt-subscription/gpt-6-astra-fast",
  "vercel/openai/gpt-6-astra",
  "GPT-6-Astra",
] as const
const GPT_5_IDS = ["openai/gpt-5.6-sol", "chatgpt-subscription/gpt-5.6-terra", "openai/gpt-5.5", "gpt-5-5"] as const
const OTHER_IDS = ["anthropic/claude-opus-5-5", "kimi-coding/k3", "zai-coding-plan/glm-5.3", undefined] as const

describe("isGpt6Model", () => {
  it("#given GPT-6 ids with and without provider prefixes or the fast alias #then all match", () => {
    for (const id of ASTRA_IDS) expect(isGpt6Model(id), id).toBe(true)
  })

  it("#given GPT-5 family and other vendor ids #then none match", () => {
    for (const id of [...GPT_5_IDS, ...OTHER_IDS]) if (id !== undefined) expect(isGpt6Model(id), id).toBe(false)
  })
})

describe("category prompt append resolvers", () => {
  describe("#given ultrabrain", () => {
    it("#when the model is GPT-6 #then the Astra append is used, otherwise the generic one", () => {
      const generic = definition("ultrabrain").promptAppend
      for (const id of ASTRA_IDS)
        expect(resolveUltrabrainCategoryPromptAppend(id), id).toBe(ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA)
      for (const id of [...GPT_5_IDS, ...OTHER_IDS])
        expect(resolveUltrabrainCategoryPromptAppend(id), String(id)).toBe(generic)
      expect(definition("ultrabrain").resolvePromptAppend).toBe(resolveUltrabrainCategoryPromptAppend)
    })
  })

  describe("#given the deep lanes", () => {
    it("#when the model is any GPT deep-lane model #then each lane uses its own GPT append", () => {
      for (const id of [...ASTRA_IDS, ...GPT_5_IDS]) {
        expect(resolveDeepLowCategoryPromptAppend(id), id).toBe(DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT)
        expect(resolveDeepHighCategoryPromptAppend(id), id).toBe(DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT)
      }
    })

    it("#when the model is another vendor or unknown #then the generic append applies", () => {
      for (const id of OTHER_IDS) {
        expect(resolveDeepLowCategoryPromptAppend(id), String(id)).toBe(DEEP_LOW_CATEGORY_PROMPT_APPEND)
        expect(resolveDeepHighCategoryPromptAppend(id), String(id)).toBe(DEEP_HIGH_CATEGORY_PROMPT_APPEND)
      }
      expect(definition("deep-low").promptAppend).toBe(DEEP_LOW_CATEGORY_PROMPT_APPEND)
      expect(definition("deep-low").resolvePromptAppend).toBe(resolveDeepLowCategoryPromptAppend)
      expect(definition("deep-high").promptAppend).toBe(DEEP_HIGH_CATEGORY_PROMPT_APPEND)
      expect(definition("deep-high").resolvePromptAppend).toBe(resolveDeepHighCategoryPromptAppend)
    })

    it("#given the deep-low appends #then only they carry the ESCALATE contract, naming deep-high", () => {
      for (const append of [DEEP_LOW_CATEGORY_PROMPT_APPEND, DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT]) {
        expect(append).toContain("ESCALATE: deep-high")
      }
      for (const append of [DEEP_HIGH_CATEGORY_PROMPT_APPEND, DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT]) {
        expect(append).not.toContain("ESCALATE")
      }
    })
  })

  describe("#given unspecified-high", () => {
    it("#when the model is GPT-6 #then the Astra append is used, otherwise the generic one", () => {
      const generic = definition("unspecified-high").promptAppend
      for (const id of ASTRA_IDS)
        expect(resolveUnspecifiedHighCategoryPromptAppend(id), id).toBe(
          UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
        )
      for (const id of [...GPT_5_IDS, ...OTHER_IDS])
        expect(resolveUnspecifiedHighCategoryPromptAppend(id), String(id)).toBe(generic)
      expect(definition("unspecified-high").resolvePromptAppend).toBe(resolveUnspecifiedHighCategoryPromptAppend)
    })
  })

  it("#given the model-specific appends #then each is a distinct Category_Context block named after its category", () => {
    const appends = {
      ultrabrain: ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
      "deep-low": DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT,
      "deep-high": DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT,
      "unspecified-high": UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
    }
    for (const [name, append] of Object.entries(appends)) {
      expect(append.startsWith(`<Category_Context name="${name}">`), name).toBe(true)
      expect(append.endsWith("</Category_Context>"), name).toBe(true)
      expect(append, name).not.toBe(definition(name).promptAppend)
    }
    expect(new Set(Object.values(appends)).size).toBe(4)
  })
})

describe("GPT builtin defaults and gates", () => {
  it("#given the builtin definitions #then ultrabrain runs Astra max, deep-high Astra high, deep-low GPT-6.2 Sol medium, all on the chatgpt-subscription lane", () => {
    expect(definition("ultrabrain").config).toEqual({ model: "chatgpt-subscription/gpt-6.2-astra", variant: "max" })
    expect(definition("deep-high").config).toEqual({ model: "chatgpt-subscription/gpt-6.2-astra", variant: "high" })
    expect(definition("deep-low").config).toEqual({ model: "chatgpt-subscription/gpt-6.2-sol", variant: "medium" })
  })

  it("#given unspecified-high #then its default is the Opus 5.5 rung its chain now leads with, not Astra", () => {
    expect(definition("unspecified-high").config).toEqual({ model: "anthropic/claude-opus-5-5", variant: "medium" })
  })

  it("#given the gates #then ultrabrain and deep-high open on gpt-6.2-astra alone, deep-low on gpt-6.2-sol alone, unspecified-high is ungated", () => {
    expect(definition("ultrabrain").requiresModel).toEqual(["gpt-6.2-astra"])
    expect(definition("deep-low").requiresModel).toEqual(["gpt-6.2-sol"])
    expect(definition("deep-high").requiresModel).toEqual(["gpt-6.2-astra"])
    expect(definition("unspecified-high").requiresModel).toBeUndefined()
  })
})

type SpecWithChain = {
  readonly provider: string
  readonly modelId: string
  readonly fallback_models?: readonly { readonly provider: string; readonly model_id: string }[]
}

function servedModels(spec: SpecWithChain): readonly string[] {
  return [spec, ...(spec.fallback_models ?? [])].map((entry) =>
    "modelId" in entry ? `${entry.provider}/${entry.modelId}` : `${entry.provider}/${entry.model_id}`,
  )
}

describe("resolveCategory on GPT registries", () => {
  const astraRegistry = registry([{ provider: "openai", id: "gpt-6.2-astra" }])
  const codexAstraRegistry = registry([{ provider: "chatgpt-subscription", id: "gpt-6.2-astra" }])
  const solRegistry = registry([{ provider: "openai", id: "gpt-6.2-sol" }])

  const astraCases = [
    { category: "ultrabrain", variant: "max", append: ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA },
    { category: "deep-high", variant: "high", append: DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT },
  ] as const

  for (const { category, variant, append } of astraCases) {
    it(`#given only the openai API lane serving gpt-6.2-astra #when ${category} resolves #then its listed rung gives Astra at ${variant} with its append`, () => {
      const result = resolveCategory(category, {}, astraRegistry)
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec).toMatchObject({
        provider: "openai",
        modelId: "gpt-6.2-astra",
        variant,
        prompt_append: append,
      })
    })

    it(`#given only chatgpt-subscription/gpt-6.2-astra #when ${category} resolves #then the subscription default carries the same variant and append`, () => {
      const result = resolveCategory(category, {}, codexAstraRegistry)
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec).toMatchObject({
        provider: "chatgpt-subscription",
        modelId: "gpt-6.2-astra",
        variant,
        prompt_append: append,
      })
    })
  }

  it("#given the subscription lane serves GPT-6.2 Sol beside older Sol tiers #when deep-low resolves #then gpt-6.2-sol runs at medium with the GPT append and no older Sol behind it", () => {
    const result = resolveCategory(
      "deep-low",
      {},
      registry([
        { provider: "chatgpt-subscription", id: "gpt-5.6-sol" },
        { provider: "chatgpt-subscription", id: "gpt-6.1-sol" },
        { provider: "chatgpt-subscription", id: "gpt-6.2-sol" },
      ]),
    )
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected resolved")
    expect(result.spec).toMatchObject({
      provider: "chatgpt-subscription",
      modelId: "gpt-6.2-sol",
      variant: "medium",
      prompt_append: DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT,
    })
    expect(servedModels(result.spec)).toEqual(["chatgpt-subscription/gpt-6.2-sol"])
  })

  // The preferred provider (the subscription, which also names the builtin default) serves only the Fast
  // tier; the exact model sits on a later provider of the same rung. delegate-core's substring match
  // would take the Fast id off the preferred provider, so these pin the exact-id narrowing (#14155).
  const fastOnPreferredCases = [
    { category: "deep-low", fast: "gpt-6.2-sol-fast", exact: "gpt-6.2-sol", secondary: "openai" },
    { category: "deep-high", fast: "gpt-6.2-astra-fast", exact: "gpt-6.2-astra", secondary: "openai" },
    { category: "ultrabrain", fast: "gpt-6.2-astra-fast", exact: "gpt-6.2-astra", secondary: "opencode" },
  ] as const
  const configCases = [
    { label: "no omo.json entry", config: (_category: string) => ({}) },
    {
      label: "a description-only omo.json entry",
      config: (category: string) => ({ categories: { [category]: { description: "house lane" } } }),
    },
  ] as const

  for (const { category, fast, exact, secondary } of fastOnPreferredCases) {
    for (const { label, config } of configCases) {
      it(`#given the subscription serves only ${fast} and ${secondary} serves ${exact}, with ${label} #when ${category} resolves #then the exact model on ${secondary} wins and Fast never enters the chain`, () => {
        const result = resolveCategory(
          category,
          config(category),
          registry([
            { provider: "chatgpt-subscription", id: fast },
            { provider: secondary, id: exact },
          ]),
        )
        expect(result.kind).toBe("resolved")
        if (result.kind !== "resolved") throw new Error("Expected resolved")
        expect(result.modelSelection.source).toBe("builtin")
        expect(result.modelSelection.fallbackEntry).toBe(CATEGORY_FALLBACK_CHAINS[category]?.[0])
        expect(servedModels(result.spec)).toEqual([`${secondary}/${exact}`])
      })
    }
  }

  it("#given the subscription serves gpt-6.2-sol and its Fast tier beside the API lane #when deep-low resolves #then the subscription's exact model wins", () => {
    const result = resolveCategory(
      "deep-low",
      {},
      registry([
        { provider: "openai", id: "gpt-6.2-sol" },
        { provider: "chatgpt-subscription", id: "gpt-6.2-sol-fast" },
        { provider: "chatgpt-subscription", id: "gpt-6.2-sol" },
      ]),
    )
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected resolved")
    expect(servedModels(result.spec)).toEqual(["chatgpt-subscription/gpt-6.2-sol"])
  })

  it("#given every lane serves older and Fast GPT models but no exact one #then all three lanes are unavailable", () => {
    const models = registry(
      ["chatgpt-subscription", "openai", "github-copilot", "opencode"].flatMap((provider) =>
        ["gpt-6-astra", "gpt-6.2-astra-fast", "gpt-6.1-sol", "gpt-6.2-sol-fast", "gpt-5.6-sol"].map((id) => ({
          provider,
          id,
        })),
      ),
    )
    for (const category of ["ultrabrain", "deep-low", "deep-high"]) {
      const result = resolveCategory(category, {}, models)
      expect(result.kind, category).toBe("model_unavailable")
      expect(result.availableCategories, category).not.toContain(category)
    }
  })

  it("#given a description-only entry and only the Fast tier #when deep-low resolves #then the gate bypass still never selects Fast", () => {
    const result = resolveCategory(
      "deep-low",
      { categories: { "deep-low": { description: "house lane" } } },
      registry([{ provider: "chatgpt-subscription", id: "gpt-6.2-sol-fast" }]),
    )
    expect(result.kind).toBe("model_unavailable")
  })

  it("#given an omo.json model override onto an older Astra #when ultrabrain resolves #then the user's model is honored", () => {
    const result = resolveCategory(
      "ultrabrain",
      { categories: { ultrabrain: { model: "openai/gpt-6-astra" } } },
      registry([{ provider: "openai", id: "gpt-6-astra" }]),
    )
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected resolved")
    expect(result.spec).toMatchObject({ provider: "openai", modelId: "gpt-6-astra" })
    expect(result.modelSelection.source).toBe("user")
  })

  it("#given an omo.json fallback_models entry naming the Fast tier #when deep-low has no exact model #then the user's entry is honored", () => {
    const result = resolveCategory(
      "deep-low",
      { categories: { "deep-low": { fallback_models: ["chatgpt-subscription/gpt-6.2-sol-fast"] } } },
      registry([{ provider: "chatgpt-subscription", id: "gpt-6.2-sol-fast" }]),
    )
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected resolved")
    expect(result.spec.modelId).toBe("gpt-6.2-sol-fast")
    expect(result.modelSelection.source).toBe("user")
  })

  it("#given only gpt-6.2-astra #when unspecified-high resolves #then it is model_unavailable, because its chain carries no GPT rung", () => {
    expect(resolveCategory("unspecified-high", {}, astraRegistry).kind).toBe("model_unavailable")
    expect(resolveCategory("unspecified-high", {}, codexAstraRegistry).kind).toBe("model_unavailable")
  })

  it("#given claude-opus-5-5 #when unspecified-high resolves #then it runs Opus 5.5 at medium with the generic append", () => {
    const result = resolveCategory("unspecified-high", {}, registry([{ provider: "anthropic", id: "claude-opus-5-5" }]))
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected resolved")
    expect(result.spec).toMatchObject({
      provider: "anthropic",
      modelId: "claude-opus-5-5",
      variant: "medium",
      prompt_append: definition("unspecified-high").promptAppend,
    })
  })

  it("#given a registry missing a lane's own model #then that lane never borrows the other lane's model", () => {
    expect(resolveCategory("deep-high", {}, solRegistry).kind).toBe("model_unavailable")
    expect(resolveCategory("deep-low", {}, astraRegistry).kind).toBe("model_unavailable")
  })

  it("#given the retired deep name #when it is spawned #then it resolves as deep-low", () => {
    const result = resolveCategory("deep", {}, solRegistry)
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected resolved")
    expect(result.category).toBe("deep-low")
    expect(result.spec).toMatchObject({ modelId: "gpt-6.2-sol", variant: "medium" })
  })

  it("#given an omo.json prompt_append for deep-high #when it resolves on Astra #then the user overlay follows the lane append", () => {
    const result = resolveCategory(
      "deep-high",
      { categories: { "deep-high": { prompt_append: "team-overlay" } } },
      astraRegistry,
    )
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected resolved")
    expect(result.spec.prompt_append).toBe(`${DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT}\n\nteam-overlay`)
  })
})
