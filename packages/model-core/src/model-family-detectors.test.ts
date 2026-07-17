import { describe, expect, test } from "bun:test"
import {
  isClaudeFable5Model,
  isClaudeOpus46Model,
  isClaudeOpus47Model,
  isClaudeOpus47OrLaterModel,
  isClaudeFableOrMythosModel,
  isClaudeOpus48Model,
  isGeminiModel,
  isGlmModel,
  isGptModel,
  isKimiK2Model,
  isKimiK27Model,
  isKimiK3Model,
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

  test("#given Kimi K2.7 model ids #then detects K2.7 only, not K2.6", () => {
    expect(isKimiK27Model("opencode-go/kimi-k2.7")).toBe(true)
    expect(isKimiK27Model("moonshotai/kimi-k2-7")).toBe(true)
    expect(isKimiK27Model("kimi-for-coding/k2p7")).toBe(true)
    expect(isKimiK27Model("opencode/k2-p7")).toBe(true)
    expect(isKimiK27Model("opencode-go/kimi-k2.6")).toBe(false)
    expect(isKimiK27Model("kimi-for-coding/k2p6")).toBe(false)
    expect(isKimiK27Model("kimi-for-coding/k2p5")).toBe(false)
    expect(isKimiK27Model("anthropic/claude-opus-4-7")).toBe(false)
    expect(isKimiK2Model("opencode-go/kimi-k2.7")).toBe(true)
  })

  test("#given Kimi K3 model ids #then detects K3 only, not K2.x", () => {
    expect(isKimiK3Model("opencode-go/kimi-k3")).toBe(true)
    expect(isKimiK3Model("moonshotai/kimi-k3-202607")).toBe(true)
    expect(isKimiK3Model("kimi-for-coding/k3p1")).toBe(true)
    expect(isKimiK3Model("opencode/k3")).toBe(true)
    expect(isKimiK3Model("opencode-go/kimi-k2.7")).toBe(false)
    expect(isKimiK3Model("kimi-for-coding/k2p7")).toBe(false)
    expect(isKimiK3Model("kimi-for-coding/k2p5")).toBe(false)
    expect(isKimiK3Model("anthropic/claude-opus-4-7")).toBe(false)
  })

  test("#given GLM model ids #then detects GLM family only", () => {
    expect(isGlmModel("z-ai/glm-5.1")).toBe(true)
    expect(isGlmModel("opencode/glm-4.6v")).toBe(true)
    expect(isGlmModel("google/gemini-3.1-pro")).toBe(false)
  })

  test("#given Claude Opus 4.6 model ids #then detects Opus 4.6 only", () => {
    expect(isClaudeOpus46Model("anthropic/claude-opus-4-6")).toBe(true)
    expect(isClaudeOpus46Model("anthropic/claude-opus-4.6")).toBe(true)
    expect(isClaudeOpus46Model("claude-opus-4-6")).toBe(true)
    expect(isClaudeOpus46Model("anthropic/claude-opus-4-7")).toBe(false)
    expect(isClaudeOpus46Model("anthropic/claude-sonnet-4-6")).toBe(false)
  })

  test("#given Claude Opus 4.7 model ids #then detects Opus 4.7 only", () => {
    expect(isClaudeOpus47Model("anthropic/claude-opus-4-7")).toBe(true)
    expect(isClaudeOpus47Model("anthropic/claude-opus-4.7")).toBe(true)
    expect(isClaudeOpus47Model("anthropic/claude-sonnet-4-6")).toBe(false)
  })

  test("#given Claude Opus 4.8 model ids #then detects Opus 4.8 only", () => {
    expect(isClaudeOpus48Model("anthropic/claude-opus-4-8")).toBe(true)
    expect(isClaudeOpus48Model("anthropic/claude-opus-4.8")).toBe(true)
    expect(isClaudeOpus48Model("anthropic/claude-opus-4-7")).toBe(false)
    expect(isClaudeOpus48Model("anthropic/claude-fable-5")).toBe(false)
  })

  test("#given Claude Fable 5 model ids #then detects Fable 5 only", () => {
    expect(isClaudeFable5Model("anthropic/claude-fable-5")).toBe(true)
    expect(isClaudeFable5Model("anthropic/claude-fable-5[1m]")).toBe(true)
    expect(isClaudeFable5Model("claude-fable-5")).toBe(true)
    expect(isClaudeFable5Model("anthropic/claude-opus-4-8")).toBe(false)
    expect(isClaudeFable5Model("anthropic/claude-sonnet-4-6")).toBe(false)
  })

  test("#given Claude Opus 4.7+ model ids #then detects 4.7 and later only", () => {
    expect(isClaudeOpus47OrLaterModel("anthropic/claude-opus-4-7")).toBe(true)
    expect(isClaudeOpus47OrLaterModel("anthropic/claude-opus-4-8")).toBe(true)
    expect(isClaudeOpus47OrLaterModel("anthropic/claude-opus-4.8")).toBe(true)
    expect(isClaudeOpus47OrLaterModel("anthropic/claude-opus-5-0")).toBe(true)
    expect(isClaudeOpus47OrLaterModel("claude-opus-4-7")).toBe(true)
    expect(isClaudeOpus47OrLaterModel("anthropic/claude-fable-5")).toBe(true)
    expect(isClaudeOpus47OrLaterModel("anthropic/claude-fable-5[1m]")).toBe(true)
    expect(isClaudeOpus47OrLaterModel("anthropic/claude-opus-4-6")).toBe(false)
    expect(isClaudeOpus47OrLaterModel("anthropic/claude-sonnet-4-6")).toBe(false)
    expect(isClaudeOpus47OrLaterModel("openai/gpt-5.5")).toBe(false)
  })

  test("#given Claude Fable/Mythos model ids #then detects fable and mythos families", () => {
    expect(isClaudeFableOrMythosModel("anthropic/claude-fable-5")).toBe(true)
    expect(isClaudeFableOrMythosModel("claude-fable-5")).toBe(true)
    expect(isClaudeFableOrMythosModel("anthropic.claude-fable-5")).toBe(true)
    expect(isClaudeFableOrMythosModel("anthropic/claude-mythos-5")).toBe(true)
    expect(isClaudeFableOrMythosModel("anthropic/claude-mythos-preview")).toBe(true)
    expect(isClaudeFableOrMythosModel("anthropic/claude-opus-4-8")).toBe(false)
    expect(isClaudeFableOrMythosModel("anthropic/claude-sonnet-4-6")).toBe(false)
    expect(isClaudeFableOrMythosModel("openai/gpt-5.5")).toBe(false)
  })

  test("#given MiniMax model ids #then detects MiniMax family only", () => {
    expect(isMiniMaxModel("opencode/minimax-m2.7")).toBe(true)
    expect(isMiniMaxModel("minimax-m2.7-highspeed")).toBe(true)
    expect(isMiniMaxModel("moonshotai/kimi-k2.6")).toBe(false)
  })
})
