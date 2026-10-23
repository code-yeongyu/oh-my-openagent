import { describe, expect, test } from "bun:test"
import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"
import { resolveActualContextLimit } from "./context-limit-resolver"
import { isClaudeFable5Model, isClaudeFableOrMythosModel, isClaudeOpus47OrLaterModel } from "./model-family-detectors"

const MODEL = "claude-fable-5-5"

describe("provisional Fable 5.5 recognition", () => {
  test("recognizes the family without depending on a catalog release", () => {
    // given / when / then
    for (const selector of [MODEL, `anthropic/${MODEL}`, "github-copilot/claude-fable-5.5"]) {
      expect(isClaudeFable5Model(selector)).toBe(true)
      expect(isClaudeFableOrMythosModel(selector)).toBe(true)
      expect(isClaudeOpus47OrLaterModel(selector)).toBe(true)
    }
  })

  test("registers the provisional model without inventing launch capabilities", () => {
    // given
    const snapshot = getBundledModelCapabilitiesSnapshot({ generatedAt: "", sourceUrl: "", models: {} })
    // when
    const result = getModelCapabilities({ providerID: "anthropic", modelID: MODEL, bundledSnapshot: snapshot })
    // then
    expect(result.family).toBe("claude-fable")
    expect(result.diagnostics.snapshot.source).toBe("bundled-snapshot")
    expect(result.maxOutputTokens).toBeUndefined()
    expect(result.toolCall).toBeUndefined()
    expect(result.modalities).toBeUndefined()
  })

  test("uses live metadata instead of provisional unknown limits", () => {
    // given
    const snapshot = getBundledModelCapabilitiesSnapshot({ generatedAt: "", sourceUrl: "", models: {} })
    // when
    const result = getModelCapabilities({
      providerID: "anthropic",
      modelID: MODEL,
      bundledSnapshot: snapshot,
      runtimeModel: { limit: { output: 12345 }, capabilities: { toolcall: true } },
    })
    // then
    expect(result.maxOutputTokens).toBe(12345)
    expect(result.toolCall).toBe(true)
    expect(result.diagnostics.maxOutputTokens.source).toBe("runtime")
  })

  test("does not clamp a live context cache to an unverified Anthropic default", () => {
    // given
    const state = {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache: new Map([[`anthropic/${MODEL}`, 345678]]),
    }
    // when
    const result = resolveActualContextLimit("anthropic", MODEL, state)
    // then
    expect(result).toBe(345678)
  })

  test("leaves the context unknown until the launch listing supplies it", () => {
    // given / when / then
    expect(resolveActualContextLimit("anthropic", MODEL, { anthropicContext1MEnabled: false })).toBeNull()
  })
})
