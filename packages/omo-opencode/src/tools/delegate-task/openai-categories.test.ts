declare const require: (name: string) => any
const { describe, test, expect } = require("bun:test")

import {
  DEEP_HIGH_CATEGORY_PROMPT_APPEND,
  DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT,
  DEEP_LOW_CATEGORY_PROMPT_APPEND,
  DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT,
  OPENAI_CATEGORIES,
  ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
  UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
  resolveDeepHighCategoryPromptAppend,
  resolveDeepLowCategoryPromptAppend,
  resolveUltrabrainCategoryPromptAppend,
  resolveUnspecifiedHighCategoryPromptAppend,
} from "./openai-categories"

const ASTRA_IDS = ["gpt-6-astra", "openai/gpt-6-astra", "openai-codex/gpt-6-astra-fast", "github-copilot/gpt-6-astra"]
const GPT_5_IDS = ["openai/gpt-5.5", "openai/gpt-5.5 medium", "openai/gpt-5-5", "openai/gpt-5.6-sol"]
const NON_GPT_IDS = ["openai/gpt-5.4", "anthropic/claude-opus-4-7", undefined]

describe("deep lane prompt append resolvers", () => {
  test("the lane artifacts are distinct, so lane routing is observable", () => {
    //#then
    expect(DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT).not.toBe(DEEP_LOW_CATEGORY_PROMPT_APPEND)
    expect(DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT).not.toBe(DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT)
  })

  test("every GPT deep-lane model resolves its lane's GPT append", () => {
    for (const id of [...ASTRA_IDS, ...GPT_5_IDS]) {
      //#then
      expect(resolveDeepLowCategoryPromptAppend(id)).toBe(DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT)
      expect(resolveDeepHighCategoryPromptAppend(id)).toBe(DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT)
    }
  })

  test("a non-GPT or unknown model resolves the generic append", () => {
    for (const id of NON_GPT_IDS) {
      //#then
      expect(resolveDeepLowCategoryPromptAppend(id)).toBe(DEEP_LOW_CATEGORY_PROMPT_APPEND)
      expect(resolveDeepHighCategoryPromptAppend(id)).toBe(DEEP_HIGH_CATEGORY_PROMPT_APPEND)
    }
  })

  test("only the deep-low appends carry the ESCALATE contract, and no deep append routes a category", () => {
    //#then
    for (const append of [DEEP_LOW_CATEGORY_PROMPT_APPEND, DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT]) {
      expect(append.includes("ESCALATE: deep-high")).toBe(true)
    }
    for (const append of [DEEP_HIGH_CATEGORY_PROMPT_APPEND, DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT]) {
      expect(append.includes("ESCALATE")).toBe(false)
    }
    for (const append of [
      DEEP_LOW_CATEGORY_PROMPT_APPEND,
      DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT,
      DEEP_HIGH_CATEGORY_PROMPT_APPEND,
      DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT,
    ]) {
      expect(append.includes("MUST USE")).toBe(false)
      expect(append.includes("CAPTCHA")).toBe(false)
    }
  })
})

describe("OPENAI_CATEGORIES deep lanes", () => {
  test("each lane exposes its own resolvePromptAppend hook", () => {
    //#given
    const low = OPENAI_CATEGORIES.find((c) => c.name === "deep-low")
    const high = OPENAI_CATEGORIES.find((c) => c.name === "deep-high")

    //#then
    expect(low?.resolvePromptAppend).toBe(resolveDeepLowCategoryPromptAppend)
    expect(high?.resolvePromptAppend).toBe(resolveDeepHighCategoryPromptAppend)
  })

  test("ultrabrain category exposes the Astra-aware resolvePromptAppend hook", () => {
    //#given
    const ultraCat = OPENAI_CATEGORIES.find((c) => c.name === "ultrabrain")

    //#then
    expect(ultraCat).toBeDefined()
    expect(ultraCat?.resolvePromptAppend).toBe(resolveUltrabrainCategoryPromptAppend)
    expect(ultraCat?.config).toEqual({ model: "openai/gpt-6-astra", variant: "max" })
  })

  test("each deep lane carries its own model and gates on it alone", () => {
    //#given
    const low = OPENAI_CATEGORIES.find((c) => c.name === "deep-low")
    const high = OPENAI_CATEGORIES.find((c) => c.name === "deep-high")
    const highCat = OPENAI_CATEGORIES.find((c) => c.name === "unspecified-high")

    //#then
    expect(low?.config).toEqual({ model: "openai/gpt-6-sol-fast", variant: "medium" })
    expect(low?.requiresModel).toEqual(["gpt-6-sol-fast", "gpt-6-sol"])
    expect(high?.config).toEqual({ model: "openai/gpt-6-astra", variant: "xhigh" })
    expect(high?.requiresModel).toBe("gpt-6-astra")
    expect(highCat?.config).toEqual({ model: "anthropic/claude-opus-5-5", variant: "medium" })
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
    for (const id of ["openai/gpt-5.6-sol", "openai/gpt-5.5", "anthropic/claude-opus-5-5", undefined]) expect(resolveUltrabrainCategoryPromptAppend(id)).toBe(generic)
  })

  test("unspecified-high resolves the Astra append for GPT-6 ids and the generic one otherwise", () => {
    const generic = OPENAI_CATEGORIES.find((c) => c.name === "unspecified-high")?.promptAppend
    for (const id of ASTRA_IDS) expect(resolveUnspecifiedHighCategoryPromptAppend(id)).toBe(UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA)
    for (const id of ["openai/gpt-5.6-sol", "anthropic/claude-opus-5-5", "zai-coding-plan/glm-5.3", undefined]) expect(resolveUnspecifiedHighCategoryPromptAppend(id)).toBe(generic)
  })

  test("the model-specific appends are distinct Category_Context blocks named after their category", () => {
    const appends = {
      ultrabrain: ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
      "deep-low": DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT,
      "deep-high": DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT,
      "unspecified-high": UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA,
    }
    for (const [name, append] of Object.entries(appends)) {
      expect(append.startsWith(`<Category_Context name="${name}">`)).toBe(true)
      expect(append.endsWith("</Category_Context>")).toBe(true)
    }
    expect(new Set(Object.values(appends)).size).toBe(4)
  })
})
