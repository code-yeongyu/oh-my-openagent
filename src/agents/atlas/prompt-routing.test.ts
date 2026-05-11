import { describe, test, expect } from "bun:test"
import { getAtlasPromptSource } from "./agent"

describe("getAtlasPromptSource routes each model family to its dedicated variant", () => {
  test("GPT models route to gpt", () => {
    expect(getAtlasPromptSource("openai/gpt-5.5")).toBe("gpt")
    expect(getAtlasPromptSource("openai/gpt-5.4")).toBe("gpt")
    expect(getAtlasPromptSource("github-copilot/gpt-5.5")).toBe("gpt")
  })

  test("Gemini models route to gemini", () => {
    expect(getAtlasPromptSource("google/gemini-3.1-pro")).toBe("gemini")
    expect(getAtlasPromptSource("google-vertex/gemini-2.5-flash")).toBe("gemini")
    expect(getAtlasPromptSource("github-copilot/gemini-2.0-pro")).toBe("gemini")
  })

  test("Kimi K2.x models route to kimi", () => {
    expect(getAtlasPromptSource("moonshotai/kimi-k2.6")).toBe("kimi")
    expect(getAtlasPromptSource("kimi-for-coding/k2p6")).toBe("kimi")
    expect(getAtlasPromptSource("opencode-go/kimi-k2.5")).toBe("kimi")
  })

  test("Claude Opus 4.7 routes to opus-4-7", () => {
    expect(getAtlasPromptSource("anthropic/claude-opus-4-7")).toBe("opus-4-7")
    expect(getAtlasPromptSource("github-copilot/claude-opus-4.7")).toBe("opus-4-7")
  })

  test("Claude 4.6 family (opus-4-6, sonnet-4-6, haiku-4-5) routes to default", () => {
    expect(getAtlasPromptSource("anthropic/claude-opus-4-6")).toBe("default")
    expect(getAtlasPromptSource("anthropic/claude-sonnet-4-6")).toBe("default")
    expect(getAtlasPromptSource("anthropic/claude-haiku-4-5")).toBe("default")
  })

  test("undefined model falls through to default", () => {
    expect(getAtlasPromptSource(undefined)).toBe("default")
  })

  test("unrecognized model falls through to default", () => {
    expect(getAtlasPromptSource("opencode-go/big-pickle")).toBe("default")
    expect(getAtlasPromptSource("zai-coding-plan/glm-5.1")).toBe("default")
  })

  test("GPT detection takes priority over Claude family naming", () => {
    expect(getAtlasPromptSource("openai/gpt-claude-something")).toBe("gpt")
  })

  test("Gemini detection precedes Kimi when both could match", () => {
    expect(getAtlasPromptSource("google/gemini-3.1-pro")).toBe("gemini")
  })
})
