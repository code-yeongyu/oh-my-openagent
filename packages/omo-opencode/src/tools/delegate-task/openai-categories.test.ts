declare const require: (name: string) => any
const { describe, test, expect } = require("bun:test")

import {
  DEEP_CATEGORY_PROMPT_APPEND,
  DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5,
  DEEP_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
  OPENAI_CATEGORIES,
  ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
  UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
  resolveDeepCategoryPromptAppend,
  resolveUltrabrainCategoryPromptAppend,
  resolveUnspecifiedHighCategoryPromptAppend,
} from "./openai-categories"

const ASTRA_IDS = ["gpt-6-astra", "openai/gpt-6-astra", "openai-codex/gpt-6-astra-fast", "github-copilot/gpt-6-astra"]

describe("resolveDeepCategoryPromptAppend", () => {
  test("the two branch artifacts are distinct, so model routing is observable", () => {
    //#then
    expect(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5).not.toBe(DEEP_CATEGORY_PROMPT_APPEND)
  })

  test("returns GPT-5.5 prompt for openai/gpt-5.5", () => {
    //#when
    const result = resolveDeepCategoryPromptAppend("openai/gpt-5.5")

    //#then
    expect(result).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
  })

  test("returns GPT-5.5 prompt for openai/gpt-5.5 with variant suffix", () => {
    //#when
    const result = resolveDeepCategoryPromptAppend("openai/gpt-5.5 medium")

    //#then
    expect(result).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
  })

  test("returns GPT-5.5 prompt for the gpt-5-5 hyphenated form", () => {
    //#when
    const result = resolveDeepCategoryPromptAppend("openai/gpt-5-5")

    //#then
    expect(result).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
  })

  test("returns legacy prompt for openai/gpt-5.4", () => {
    //#when
    const result = resolveDeepCategoryPromptAppend("openai/gpt-5.4")

    //#then
    expect(result).toBe(DEEP_CATEGORY_PROMPT_APPEND)
  })

  test("returns legacy prompt for undefined model", () => {
    //#when
    const result = resolveDeepCategoryPromptAppend(undefined)

    //#then
    expect(result).toBe(DEEP_CATEGORY_PROMPT_APPEND)
  })

  test("returns legacy prompt for a non-GPT model", () => {
    //#when
    const result = resolveDeepCategoryPromptAppend("anthropic/claude-opus-4-7")

    //#then
    expect(result).toBe(DEEP_CATEGORY_PROMPT_APPEND)
  })
})

describe("OPENAI_CATEGORIES deep entry", () => {
  test("exposes a resolvePromptAppend hook on the deep category", () => {
    //#given
    const deepCat = OPENAI_CATEGORIES.find((c) => c.name === "deep")

    //#then
    expect(deepCat).toBeDefined()
    expect(deepCat?.resolvePromptAppend).toBeDefined()
    expect(typeof deepCat?.resolvePromptAppend).toBe("function")
  })

  test("deep category resolver picks GPT-5.5 prompt for gpt-5.5 model", () => {
    //#given
    const deepCat = OPENAI_CATEGORIES.find((c) => c.name === "deep")

    //#when
    const result = deepCat?.resolvePromptAppend?.("openai/gpt-5.5")

    //#then
    expect(result).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
  })

  test("deep category resolver falls back to legacy for non-gpt-5.5 models", () => {
    //#given
    const deepCat = OPENAI_CATEGORIES.find((c) => c.name === "deep")

    //#when
    const result = deepCat?.resolvePromptAppend?.("openai/gpt-5.4")

    //#then
    expect(result).toBe(DEEP_CATEGORY_PROMPT_APPEND)
  })

  test("ultrabrain category exposes the Astra-aware resolvePromptAppend hook", () => {
    //#given
    const ultraCat = OPENAI_CATEGORIES.find((c) => c.name === "ultrabrain")

    //#then
    expect(ultraCat).toBeDefined()
    expect(ultraCat?.resolvePromptAppend).toBe(resolveUltrabrainCategoryPromptAppend)
    expect(ultraCat?.config).toEqual({ model: "openai/gpt-6-astra", variant: "max" })
  })

  test("deep and unspecified-high run GPT-6 Astra at high, and deep opens on either GPT flagship", () => {
    //#given
    const deepCat = OPENAI_CATEGORIES.find((c) => c.name === "deep")
    const highCat = OPENAI_CATEGORIES.find((c) => c.name === "unspecified-high")

    //#then
    expect(deepCat?.config).toEqual({ model: "openai/gpt-6-astra", variant: "high" })
    expect(deepCat?.requiresModel).toEqual(["gpt-6-astra", "gpt-5.6-sol"])
    expect(highCat?.config).toEqual({ model: "openai/gpt-6-astra", variant: "high" })
    expect(highCat?.resolvePromptAppend).toBe(resolveUnspecifiedHighCategoryPromptAppend)
  })

  test("quick category does not expose a resolvePromptAppend hook", () => {
    //#given
    const quickCat = OPENAI_CATEGORIES.find((c) => c.name === "quick")

    //#then
    expect(quickCat).toBeDefined()
    expect(quickCat?.resolvePromptAppend).toBeUndefined()
  })
})

describe("GPT-6 Astra category prompt appends", () => {
  test("ultrabrain resolves the Astra append for GPT-6 ids and the generic one otherwise", () => {
    const generic = OPENAI_CATEGORIES.find((c) => c.name === "ultrabrain")?.promptAppend
    for (const id of ASTRA_IDS) expect(resolveUltrabrainCategoryPromptAppend(id)).toBe(ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA)
    for (const id of ["openai/gpt-5.6-sol", "openai/gpt-5.5", "anthropic/claude-opus-5", undefined]) expect(resolveUltrabrainCategoryPromptAppend(id)).toBe(generic)
  })

  test("deep resolves the Astra append ahead of the GPT-5.5 one for GPT-6 ids", () => {
    for (const id of ASTRA_IDS) expect(resolveDeepCategoryPromptAppend(id)).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA)
    expect(resolveDeepCategoryPromptAppend("openai/gpt-5.6-sol")).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
  })

  test("unspecified-high resolves the Astra append for GPT-6 ids and the generic one otherwise", () => {
    const generic = OPENAI_CATEGORIES.find((c) => c.name === "unspecified-high")?.promptAppend
    for (const id of ASTRA_IDS) expect(resolveUnspecifiedHighCategoryPromptAppend(id)).toBe(UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA)
    for (const id of ["openai/gpt-5.6-sol", "anthropic/claude-opus-5", "zai-coding-plan/glm-5.3", undefined]) expect(resolveUnspecifiedHighCategoryPromptAppend(id)).toBe(generic)
  })

  test("the three Astra appends are distinct Category_Context blocks named after their category", () => {
    const appends = {
      ultrabrain: ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
      deep: DEEP_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
      "unspecified-high": UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
    }
    for (const [name, append] of Object.entries(appends)) {
      expect(append.startsWith(`<Category_Context name="${name}">`)).toBe(true)
      expect(append.endsWith("</Category_Context>")).toBe(true)
    }
    expect(new Set(Object.values(appends)).size).toBe(3)
  })
})
