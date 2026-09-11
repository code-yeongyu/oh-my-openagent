/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { resolveCategory } from "./index"
import {
  DEEP_CATEGORY_PROMPT_APPEND,
  DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5,
  DEEP_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
  OPENAI_CATEGORIES,
  ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
  UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
  isGpt6Model,
  resolveDeepCategoryPromptAppend,
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

const ASTRA_IDS = ["gpt-6-astra", "openai/gpt-6-astra", "openai-codex/gpt-6-astra-fast", "vercel/openai/gpt-6-astra", "GPT-6-Astra"] as const
const GPT_5_IDS = ["openai/gpt-5.6-sol", "openai-codex/gpt-5.6-terra", "openai/gpt-5.5", "gpt-5-5"] as const
const OTHER_IDS = ["anthropic/claude-opus-5", "kimi-coding/k3", "zai-coding-plan/glm-5.3", undefined] as const

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
      for (const id of ASTRA_IDS) expect(resolveUltrabrainCategoryPromptAppend(id), id).toBe(ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA)
      for (const id of [...GPT_5_IDS, ...OTHER_IDS]) expect(resolveUltrabrainCategoryPromptAppend(id), String(id)).toBe(generic)
      expect(definition("ultrabrain").resolvePromptAppend).toBe(resolveUltrabrainCategoryPromptAppend)
    })
  })

  describe("#given deep", () => {
    it("#when the model is GPT-6 #then the Astra append wins over the GPT-5.5 one", () => {
      for (const id of ASTRA_IDS) expect(resolveDeepCategoryPromptAppend(id), id).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA)
    })

    it("#when the model is GPT-5.5 or GPT-5.6 #then the GPT-5.5 append still applies", () => {
      for (const id of GPT_5_IDS) expect(resolveDeepCategoryPromptAppend(id), id).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
    })

    it("#when the model is another vendor or unknown #then the generic append applies", () => {
      for (const id of OTHER_IDS) expect(resolveDeepCategoryPromptAppend(id), String(id)).toBe(DEEP_CATEGORY_PROMPT_APPEND)
      expect(definition("deep").promptAppend).toBe(DEEP_CATEGORY_PROMPT_APPEND)
      expect(definition("deep").resolvePromptAppend).toBe(resolveDeepCategoryPromptAppend)
    })
  })

  describe("#given unspecified-high", () => {
    it("#when the model is GPT-6 #then the Astra append is used, otherwise the generic one", () => {
      const generic = definition("unspecified-high").promptAppend
      for (const id of ASTRA_IDS) expect(resolveUnspecifiedHighCategoryPromptAppend(id), id).toBe(UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA)
      for (const id of [...GPT_5_IDS, ...OTHER_IDS]) expect(resolveUnspecifiedHighCategoryPromptAppend(id), String(id)).toBe(generic)
      expect(definition("unspecified-high").resolvePromptAppend).toBe(resolveUnspecifiedHighCategoryPromptAppend)
    })
  })

  it("#given the three Astra appends #then each is a distinct Category_Context block named after its category", () => {
    const appends = {
      ultrabrain: ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
      deep: DEEP_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
      "unspecified-high": UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
    }
    for (const [name, append] of Object.entries(appends)) {
      expect(append.startsWith(`<Category_Context name="${name}">`), name).toBe(true)
      expect(append.endsWith("</Category_Context>"), name).toBe(true)
      expect(append, name).not.toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
      expect(append, name).not.toBe(definition(name).promptAppend)
    }
    expect(new Set(Object.values(appends)).size).toBe(3)
  })
})

describe("GPT-6 Astra builtin defaults and gates", () => {
  it("#given the builtin definitions #then ultrabrain runs Astra at max, deep and unspecified-high at high", () => {
    expect(definition("ultrabrain").config).toEqual({ model: "openai/gpt-6-astra", variant: "max" })
    expect(definition("deep").config).toEqual({ model: "openai/gpt-6-astra", variant: "high" })
    expect(definition("unspecified-high").config).toEqual({ model: "openai/gpt-6-astra", variant: "high" })
  })

  it("#given the GPT flagship gate #then ultrabrain and deep open on either Astra or Sol and unspecified-high is ungated", () => {
    expect(definition("ultrabrain").requiresModel).toEqual(["gpt-6-astra", "gpt-5.6-sol"])
    expect(definition("deep").requiresModel).toEqual(["gpt-6-astra", "gpt-5.6-sol"])
    expect(definition("unspecified-high").requiresModel).toBeUndefined()
  })
})

describe("resolveCategory on a GPT-6 Astra registry", () => {
  const astraRegistry = registry([{ provider: "openai", id: "gpt-6-astra" }])
  const codexAstraRegistry = registry([{ provider: "openai-codex", id: "gpt-6-astra" }])
  const solRegistry = registry([{ provider: "openai", id: "gpt-5.6-sol" }])

  const cases = [
    { category: "ultrabrain", variant: "max", append: ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA },
    { category: "deep", variant: "high", append: DEEP_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA },
    { category: "unspecified-high", variant: "high", append: UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA },
  ] as const

  for (const { category, variant, append } of cases) {
    it(`#given only openai/gpt-6-astra #when ${category} resolves #then the child gets Astra at ${variant} with the Astra append`, () => {
      const result = resolveCategory(category, {}, astraRegistry)
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec).toMatchObject({ provider: "openai", modelId: "gpt-6-astra", variant, prompt_append: append })
    })

    it(`#given only openai-codex/gpt-6-astra #when ${category} resolves #then the codex rung carries the same variant and append`, () => {
      const result = resolveCategory(category, {}, codexAstraRegistry)
      expect(result.kind).toBe("resolved")
      if (result.kind !== "resolved") throw new Error("Expected resolved")
      expect(result.spec).toMatchObject({ provider: "openai-codex", modelId: "gpt-6-astra", variant, prompt_append: append })
    })
  }

  it("#given only gpt-5.6-sol #when deep resolves #then the GPT-5.5 append rides the sol rung", () => {
    const result = resolveCategory("deep", {}, solRegistry)
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected resolved")
    expect(result.spec).toMatchObject({ modelId: "gpt-5.6-sol", variant: "medium", prompt_append: DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5 })
  })

  it("#given an omo.json prompt_append for deep #when it resolves on Astra #then the user overlay follows the Astra append", () => {
    const result = resolveCategory("deep", { categories: { deep: { prompt_append: "team-overlay" } } }, astraRegistry)
    expect(result.kind).toBe("resolved")
    if (result.kind !== "resolved") throw new Error("Expected resolved")
    expect(result.spec.prompt_append).toBe(`${DEEP_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA}\n\nteam-overlay`)
  })
})
