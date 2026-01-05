import { describe, expect, test } from "bun:test"
import { isGptModel } from "./types"

describe("isGptModel", () => {
  test("detects OpenAI-style models with or without provider prefix", () => {
    // #given / #then
    expect(isGptModel("openai/gpt-5.2")).toBe(true)
    expect(isGptModel("gpt-5.2")).toBe(true)
    expect(isGptModel("codex-1")).toBe(true)
    expect(isGptModel("openai/codex-1")).toBe(true)
    expect(isGptModel("o3")).toBe(true)
  })

  test("rejects non-OpenAI models", () => {
    // #given / #then
    expect(isGptModel("anthropic/claude-opus-4-5")).toBe(false)
    expect(isGptModel("google/gemini-3-pro")).toBe(false)
    expect(isGptModel("opencode/big-pickle")).toBe(false)
  })
})
