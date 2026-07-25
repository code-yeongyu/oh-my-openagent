import { describe, expect, test } from "bun:test"
import { resolveAgentPromptAppend } from "./resolve-prompt-append"

describe("resolveAgentPromptAppend", () => {
  test("preserves conditional and always source order", () => {
    const result = resolveAgentPromptAppend({
      model: "google/gemini-3.1-pro",
      promptAppend: ["conditional-one", "conditional-two"],
      promptAppendAlways: ["always-one", "always-two"],
      includeModelKeywords: ["gemini"],
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

  test("skips conditional sources when the model ID does not match an include keyword", () => {
    const result = resolveAgentPromptAppend({
      model: "openai/gpt-5.6-sol",
      promptAppend: "conditional",
      promptAppendAlways: "always",
      includeModelKeywords: [" claude ", " gemini "],
    })

    expect(result).toBe("always")
  })

  test("gives exclusions precedence when include and exclude keywords both match", () => {
    const result = resolveAgentPromptAppend({
      model: "openai/gpt-5.6-sol",
      promptAppend: "conditional",
      promptAppendAlways: "always",
      includeModelKeywords: ["gpt"],
      excludeModelKeywords: ["5.6"],
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

  test("skips conditional sources for an unknown model when include keywords are configured", () => {
    expect(resolveAgentPromptAppend({
      promptAppend: "conditional",
      promptAppendAlways: "always",
      includeModelKeywords: ["gemini"],
    })).toBe("always")
  })

  test("treats empty include keywords as no restriction", () => {
    expect(resolveAgentPromptAppend({
      model: "openai/gpt-5.6-sol",
      promptAppend: "conditional",
      includeModelKeywords: ["", "  "],
    })).toBe("conditional")
  })

  test("treats empty literal sources as no-ops", () => {
    expect(resolveAgentPromptAppend({
      promptAppend: "",
      promptAppendAlways: ["", "always"],
    })).toBe("always")
    expect(resolveAgentPromptAppend({ promptAppend: "" })).toBeUndefined()
  })
})
