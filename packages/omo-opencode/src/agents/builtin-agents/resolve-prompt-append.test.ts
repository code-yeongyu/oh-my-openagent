import { describe, expect, test } from "bun:test"
import { resolveAgentPromptAppend } from "./resolve-prompt-append"

describe("resolveAgentPromptAppend", () => {
  test("preserves conditional and always source order", () => {
    const result = resolveAgentPromptAppend({
      model: "google/gemini-3.1-pro",
      promptAppend: ["conditional-one", "conditional-two"],
      promptAppendAlways: ["always-one", "always-two"],
      excludeModelKeywords: ["claude", "gpt"],
    })

    expect(result).toBe("conditional-one\n\nconditional-two\n\nalways-one\n\nalways-two")
  })

  test("skips conditional sources when the model ID matches a keyword", () => {
    const result = resolveAgentPromptAppend({
      model: "openai/GPT-5.6-Sol",
      promptAppend: "conditional",
      promptAppendAlways: "always",
      excludeModelKeywords: [" claude ", " gpt "],
    })

    expect(result).toBe("always")
  })

  test("does not match provider names or empty keywords", () => {
    const result = resolveAgentPromptAppend({
      model: "gpt-provider/gemini-3.1-pro",
      promptAppend: ["first", "first"],
      excludeModelKeywords: ["", "gpt"],
    })

    expect(result).toBe("first\n\nfirst")
  })

  test("keeps conditional sources when the model is unknown", () => {
    expect(resolveAgentPromptAppend({
      promptAppend: "conditional",
      promptAppendAlways: "always",
      excludeModelKeywords: ["gpt"],
    })).toBe("conditional\n\nalways")
  })

  test("treats empty literal sources as no-ops", () => {
    expect(resolveAgentPromptAppend({
      promptAppend: "",
      promptAppendAlways: ["", "always"],
    })).toBe("always")
    expect(resolveAgentPromptAppend({ promptAppend: "" })).toBeUndefined()
  })
})
