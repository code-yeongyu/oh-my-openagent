declare const require: (name: string) => any
const { describe, test, expect } = require("bun:test")

import {
  DEEP_CATEGORY_PROMPT_APPEND,
  DEEP_CATEGORY_PROMPT_APPEND_GPT_5_3_CODEX,
  DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5,
  OPENAI_CATEGORIES,
  resolveDeepCategoryPromptAppend,
} from "./openai-categories"

describe("DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5", () => {
  test("uses Category_Context wrapper with name=\"deep\"", () => {
    //#given
    const prompt = DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5

    //#then
    expect(prompt).toContain('<Category_Context name="deep">')
    expect(prompt).toContain("</Category_Context>")
  })

  test("contains GPT-5.5 prose-first style markers from the deep.md draft", () => {
    //#given
    const prompt = DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5

    //#then
    expect(prompt).toContain("operating in DEEP mode")
    expect(prompt).toContain("Exploration budget: generous")
    expect(prompt).toContain("five to fifteen minutes")
    expect(prompt).toContain("Goal, not plan")
    expect(prompt).toContain("Atomic task treatment")
    expect(prompt).toContain("Root cause bias")
    expect(prompt).toContain("Ambition scaled to context")
    expect(prompt).toContain("Completion bar: full delivery")
    expect(prompt).toContain("Status cadence: sparse")
  })

  test("does not use the legacy threat-frame phrasing", () => {
    //#given
    const prompt = DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5

    //#then
    expect(prompt).not.toContain("You are NOT an interactive assistant")
    expect(prompt).not.toContain("BEFORE making ANY changes")
  })

  test("is materially different from the legacy DEEP_CATEGORY_PROMPT_APPEND", () => {
    //#then
    expect(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5).not.toBe(DEEP_CATEGORY_PROMPT_APPEND)
    expect(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5.length).toBeGreaterThan(
      DEEP_CATEGORY_PROMPT_APPEND.length,
    )
  })
})

describe("DEEP_CATEGORY_PROMPT_APPEND_GPT_5_3_CODEX", () => {
  test("uses Category_Context wrapper with name=\"deep\"", () => {
    //#given
    const prompt = DEEP_CATEGORY_PROMPT_APPEND_GPT_5_3_CODEX

    //#then
    expect(prompt).toContain('<Category_Context name="deep">')
    expect(prompt).toContain("</Category_Context>")
  })

  test("contains GPT-5.3-Codex-specific style markers", () => {
    //#given
    const prompt = DEEP_CATEGORY_PROMPT_APPEND_GPT_5_3_CODEX

    //#then
    expect(prompt).toContain("GPT-5.3-Codex")
    expect(prompt).toContain("Autonomy and persistence")
    expect(prompt).toContain("Goal, not plan")
    expect(prompt).toContain("Code implementation")
    expect(prompt).toContain("Worktree safety")
    expect(prompt).toContain("Completion bar")
    expect(prompt).toContain("Final message")
  })

  test("preserves legacy DEEP knowledge from both default and 5.5 variants", () => {
    //#given
    const prompt = DEEP_CATEGORY_PROMPT_APPEND_GPT_5_3_CODEX

    //#then
    expect(prompt).toContain("atomic task")
    expect(prompt).toContain("root cause")
    expect(prompt).toContain("Bias to action")
    expect(prompt).toContain("complete mental model")
    expect(prompt).toContain("Ambition scaled")
  })

  test("uses parallel-batch exploration framing instead of legacy silent-exploration", () => {
    //#given
    const prompt = DEEP_CATEGORY_PROMPT_APPEND_GPT_5_3_CODEX

    //#then
    expect(prompt).toContain("Batch everything")
    expect(prompt).toContain("maximize parallelism")
    expect(prompt).not.toContain("five to fifteen minutes")
  })

  test("is materially different from both DEEP_CATEGORY_PROMPT_APPEND and DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5", () => {
    //#then
    expect(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_3_CODEX).not.toBe(DEEP_CATEGORY_PROMPT_APPEND)
    expect(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_3_CODEX).not.toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5)
  })
})

describe("resolveDeepCategoryPromptAppend", () => {
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

  test("returns GPT-5.3-codex prompt for openai/gpt-5.3-codex", () => {
    //#when
    const result = resolveDeepCategoryPromptAppend("openai/gpt-5.3-codex")

    //#then
    expect(result).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_3_CODEX)
  })

  test("returns GPT-5.3-codex prompt for the gpt-5-3-codex hyphenated form", () => {
    //#when
    const result = resolveDeepCategoryPromptAppend("openai/gpt-5-3-codex")

    //#then
    expect(result).toBe(DEEP_CATEGORY_PROMPT_APPEND_GPT_5_3_CODEX)
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
