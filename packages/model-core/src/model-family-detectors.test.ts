import { describe, expect, test } from "bun:test"
import {
  isClaudeOpus47Model,
  isGeminiModel,
  isGlmModel,
  isGptModel,
  isKimiK2Model,
  isMiniMaxModel,
} from "./model-family-detectors"

describe("model family detectors", () => {
  test("#given GPT model ids #then detects GPT family only", () => {
    expect(isGptModel("openai/gpt-5.5")).toBe(true)
    expect(isGptModel("github-copilot/gpt-4o")).toBe(true)
    expect(isGptModel("openai/o3-mini")).toBe(false)
    expect(isGptModel("anthropic/claude-opus-4-7")).toBe(false)
  })

  test("#given Gemini model ids #then detects Gemini family only", () => {
    expect(isGeminiModel("google/gemini-3.1-pro")).toBe(true)
    expect(isGeminiModel("google-vertex/gemini-3-flash")).toBe(true)
    expect(isGeminiModel("github-copilot/gemini-3.1-pro")).toBe(true)
    expect(isGeminiModel("openai/gpt-5.5")).toBe(false)
  })

  test("#given Kimi K2 model ids #then detects Kimi K2 family only", () => {
    expect(isKimiK2Model("moonshotai/kimi-k2.6")).toBe(true)
    expect(isKimiK2Model("opencode/k2p5")).toBe(true)
    expect(isKimiK2Model("opencode/k2-p6")).toBe(true)
    expect(isKimiK2Model("anthropic/claude-opus-4-7")).toBe(false)
  })

  test("#given GLM model ids #then detects GLM family only", () => {
    expect(isGlmModel("z-ai/glm-5.1")).toBe(true)
    expect(isGlmModel("opencode/glm-4.6v")).toBe(true)
    expect(isGlmModel("google/gemini-3.1-pro")).toBe(false)
  })

  test("#given Claude Opus 4.7 model ids #then detects Opus 4.7 only", () => {
    expect(isClaudeOpus47Model("anthropic/claude-opus-4-7")).toBe(true)
    expect(isClaudeOpus47Model("anthropic/claude-opus-4.7")).toBe(true)
    expect(isClaudeOpus47Model("anthropic/claude-sonnet-4-6")).toBe(false)
  })

  test("#given MiniMax model ids #then detects MiniMax family only", () => {
    expect(isMiniMaxModel("opencode/minimax-m2.7")).toBe(true)
    expect(isMiniMaxModel("minimax-m2.7-highspeed")).toBe(true)
    expect(isMiniMaxModel("moonshotai/kimi-k2.6")).toBe(false)
  })
})
