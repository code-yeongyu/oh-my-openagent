import { TEST_PROVIDERS, TEST_MODELS, TEST_QUALIFIED } from "./testing/model-fixtures";
import { SUPPORTED_MODELS } from "./registry";
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
  isMiniMaxModel,
} from "./model-family-detectors"

describe("model family detectors", () => {
  test("#given GPT model ids #then detects GPT family only", () => {
    expect(isGptModel(`${SUPPORTED_PROVIDERS.OPENAI}/${SUPPORTED_MODELS.GPT_5_5}`)).toBe(true)
    expect(isGptModel(`${SUPPORTED_PROVIDERS.GITHUB_COPILOT}/${SUPPORTED_MODELS.GPT_4O}`)).toBe(true)
    expect(isGptModel(`${SUPPORTED_PROVIDERS.OPENAI}/${SUPPORTED_MODELS.O3_MINI}`)).toBe(false)
    expect(isGptModel(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_7}`)).toBe(false)
  })

  test("#given Gemini model ids #then detects Gemini family only", () => {
    expect(isGeminiModel(`${SUPPORTED_PROVIDERS.GOOGLE}/${SUPPORTED_MODELS.GEMINI_3_1_PRO}`)).toBe(true)
    expect(isGeminiModel(`${SUPPORTED_PROVIDERS.GOOGLE_VERTEX}/${SUPPORTED_MODELS.GEMINI_3_FLASH}`)).toBe(true)
    expect(isGeminiModel(`${SUPPORTED_PROVIDERS.GITHUB_COPILOT}/${SUPPORTED_MODELS.GEMINI_3_1_PRO}`)).toBe(true)
    expect(isGeminiModel(`${SUPPORTED_PROVIDERS.OPENAI}/${SUPPORTED_MODELS.GPT_5_5}`)).toBe(false)
  })

  test("#given Kimi K2 model ids #then detects Kimi K2 family only", () => {
    expect(isKimiK2Model(`${SUPPORTED_PROVIDERS.MOONSHOTAI}/${SUPPORTED_MODELS.KIMI_K2_6}`)).toBe(true)
    expect(isKimiK2Model(`${SUPPORTED_PROVIDERS.OPENCODE}/${SUPPORTED_MODELS.KIMI_K2P5}`)).toBe(true)
    expect(isKimiK2Model("opencode/k2-p6")).toBe(true)
    expect(isKimiK2Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_7}`)).toBe(false)
  })

  test("#given Kimi K2.7 model ids #then detects K2.7 only, not K2.6", () => {
    expect(isKimiK27Model("opencode-go/kimi-k2.7")).toBe(true)
    expect(isKimiK27Model("moonshotai/kimi-k2-7")).toBe(true)
    expect(isKimiK27Model("kimi-for-coding/k2p7")).toBe(true)
    expect(isKimiK27Model("opencode/k2-p7")).toBe(true)
    expect(isKimiK27Model(`${SUPPORTED_PROVIDERS.OPENCODE_GO}/${SUPPORTED_MODELS.KIMI_K2_6}`)).toBe(false)
    expect(isKimiK27Model("kimi-for-coding/k2p6")).toBe(false)
    expect(isKimiK27Model("kimi-for-coding/k2p5")).toBe(false)
    expect(isKimiK27Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_7}`)).toBe(false)
    expect(isKimiK2Model("opencode-go/kimi-k2.7")).toBe(true)
  })

  test("#given GLM model ids #then detects GLM family only", () => {
    expect(isGlmModel(`${SUPPORTED_PROVIDERS.ZAI}/${SUPPORTED_MODELS.GLM_5_1}`)).toBe(true)
    expect(isGlmModel(`${SUPPORTED_PROVIDERS.OPENCODE}/${SUPPORTED_MODELS.GLM_4_6V}`)).toBe(true)
    expect(isGlmModel(`${SUPPORTED_PROVIDERS.GOOGLE}/${SUPPORTED_MODELS.GEMINI_3_1_PRO}`)).toBe(false)
  })

  test("#given Claude Opus 4.6 model ids #then detects Opus 4.6 only", () => {
    expect(isClaudeOpus46Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_6}`)).toBe(true)
    expect(isClaudeOpus46Model(TEST_QUALIFIED.ANTHROPIC_CLAUDE_OPUS_4_6_ALT)).toBe(true)
    expect(isClaudeOpus46Model(SUPPORTED_MODELS.CLAUDE_OPUS_4_6)).toBe(true)
    expect(isClaudeOpus46Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_7}`)).toBe(false)
    expect(isClaudeOpus46Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_SONNET_4_6}`)).toBe(false)
  })

  test("#given Claude Opus 4.7 model ids #then detects Opus 4.7 only", () => {
    expect(isClaudeOpus47Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_7}`)).toBe(true)
    expect(isClaudeOpus47Model(TEST_QUALIFIED.ANTHROPIC_CLAUDE_OPUS_4_7_ALT)).toBe(true)
    expect(isClaudeOpus47Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_SONNET_4_6}`)).toBe(false)
  })

  test("#given Claude Opus 4.8 model ids #then detects Opus 4.8 only", () => {
    expect(isClaudeOpus48Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_8}`)).toBe(true)
    expect(isClaudeOpus48Model(TEST_QUALIFIED.ANTHROPIC_CLAUDE_OPUS_4_8_ALT)).toBe(true)
    expect(isClaudeOpus48Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_7}`)).toBe(false)
    expect(isClaudeOpus48Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_FABLE_5}`)).toBe(false)
  })

  test("#given Claude Fable 5 model ids #then detects Fable 5 only", () => {
    expect(isClaudeFable5Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_FABLE_5}`)).toBe(true)
    expect(isClaudeFable5Model("anthropic/claude-fable-5[1m]")).toBe(true)
    expect(isClaudeFable5Model(SUPPORTED_MODELS.CLAUDE_FABLE_5)).toBe(true)
    expect(isClaudeFable5Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_8}`)).toBe(false)
    expect(isClaudeFable5Model(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_SONNET_4_6}`)).toBe(false)
  })

  test("#given Claude Opus 4.7+ model ids #then detects 4.7 and later only", () => {
    expect(isClaudeOpus47OrLaterModel(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_7}`)).toBe(true)
    expect(isClaudeOpus47OrLaterModel(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_8}`)).toBe(true)
    expect(isClaudeOpus47OrLaterModel(TEST_QUALIFIED.ANTHROPIC_CLAUDE_OPUS_4_8_ALT)).toBe(true)
    expect(isClaudeOpus47OrLaterModel(TEST_QUALIFIED.ANTHROPIC_CLAUDE_OPUS_5_0)).toBe(true)
    expect(isClaudeOpus47OrLaterModel(SUPPORTED_MODELS.CLAUDE_OPUS_4_7)).toBe(true)
    expect(isClaudeOpus47OrLaterModel(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_FABLE_5}`)).toBe(true)
    expect(isClaudeOpus47OrLaterModel("anthropic/claude-fable-5[1m]")).toBe(true)
    expect(isClaudeOpus47OrLaterModel(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_OPUS_4_6}`)).toBe(false)
    expect(isClaudeOpus47OrLaterModel(`${SUPPORTED_PROVIDERS.ANTHROPIC}/${SUPPORTED_MODELS.CLAUDE_SONNET_4_6}`)).toBe(false)
    expect(isClaudeOpus47OrLaterModel(`${SUPPORTED_PROVIDERS.OPENAI}/${SUPPORTED_MODELS.GPT_5_5}`)).toBe(false)
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
    expect(isMiniMaxModel(`${SUPPORTED_PROVIDERS.OPENCODE}/${SUPPORTED_MODELS.MINIMAX_M2_7}`)).toBe(true)
    expect(isMiniMaxModel(SUPPORTED_MODELS.MINIMAX_M2_7_HIGHSPEED)).toBe(true)
    expect(isMiniMaxModel(`${SUPPORTED_PROVIDERS.MOONSHOTAI}/${SUPPORTED_MODELS.KIMI_K2_6}`)).toBe(false)
  })
})
