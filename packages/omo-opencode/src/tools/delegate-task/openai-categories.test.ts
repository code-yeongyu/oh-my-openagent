declare const require: (name: string) => any
const { describe, test, expect } = require("bun:test")

import {
  DEEP_CATEGORY_PROMPT_APPEND,
  DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5,
  OPENAI_CATEGORIES,
  resolveDeepCategoryPromptAppend,
} from "./openai-categories"

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

  test("ultrabrain category does not expose a resolvePromptAppend hook", () => {
    //#given
    const ultraCat = OPENAI_CATEGORIES.find((c) => c.name === "ultrabrain")

    //#then
    expect(ultraCat).toBeDefined()
    expect(ultraCat?.resolvePromptAppend).toBeUndefined()
  })

  test("quick category does not expose a resolvePromptAppend hook", () => {
    //#given
    const quickCat = OPENAI_CATEGORIES.find((c) => c.name === "quick")

    //#then
    expect(quickCat).toBeDefined()
    expect(quickCat?.resolvePromptAppend).toBeUndefined()
  })
})
