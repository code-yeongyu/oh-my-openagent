import { describe, expect, test } from "bun:test"
import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"
import { resolveActualContextLimit } from "./context-limit-resolver"
import { LATEST_MODEL_BY_FAMILY } from "./latest-models"
import { isClaudeFable5Model, isClaudeFableOrMythosModel, isClaudeOpus47OrLaterModel } from "./model-family-detectors"
import { transformModelForProvider } from "./provider-model-id-transform"

const MODEL = "claude-fable-5-2"
const noOptIn = { anthropicContext1MEnabled: false }

describe("Claude Fable 5.2 recognition", () => {
  test("is the current Fable family pin", () => {
    // given / when / then
    expect(LATEST_MODEL_BY_FAMILY.claudeFable).toBe(MODEL)
  })

  test("recognizes every Fable and Mythos 5.2 spelling as the adaptive-only family", () => {
    // given
    const fableSelectors = [
      MODEL,
      `anthropic/${MODEL}`,
      "github-copilot/claude-fable-5.2",
      "anthropic.claude-fable-5-2",
      "us.anthropic.claude-fable-5-2",
    ]
    // when / then
    for (const selector of [...fableSelectors, "claude-mythos-5-2"])
      expect(isClaudeFableOrMythosModel(selector)).toBe(true)
    for (const selector of fableSelectors) expect(isClaudeOpus47OrLaterModel(selector)).toBe(true)
    expect(isClaudeFable5Model(`anthropic/${MODEL}`)).toBe(true)
  })

  test("registers the launch capabilities without depending on a generated catalog row", () => {
    // given
    const snapshot = getBundledModelCapabilitiesSnapshot({ generatedAt: "", sourceUrl: "", models: {} })
    // when
    const result = getModelCapabilities({ providerID: "anthropic", modelID: MODEL, bundledSnapshot: snapshot })
    // then
    expect(result.family).toBe("claude-fable")
    expect(result.diagnostics.snapshot.source).toBe("bundled-snapshot")
    expect(result.maxOutputTokens).toBe(128_000)
    expect(result.toolCall).toBe(true)
    expect(result.modalities).toEqual({ input: ["text", "image", "pdf"], output: ["text"] })
  })

  test("keeps ids just outside the 5.2 boundary at the default window without the opt-in (#12985)", () => {
    // given: neighbours a loosened 5.2 pattern would start to match
    const outside: [string, string][] = [
      ["anthropic", "claude-fable-5-20"],
      ["anthropic", "claude-fable-5-2-2026110"],
      ["anthropic", "claude-fable-5-21"],
      ["anthropic", "claude-opus-5-2"],
      ["anthropic", "claude-fable-5-1-20260601"],
      ["aws-bedrock-anthropic", "anthropic.claude-fable-5-20"],
    ]
    // when
    const limits = outside.map(([provider, model]) => resolveActualContextLimit(provider, model, noOptIn))
    // then
    expect(limits).toEqual(outside.map(() => 200_000))
  })

  test("uses the 1M context window on every Anthropic-family spelling without the opt-in", () => {
    // given
    const spellings: [string, string][] = [
      ["anthropic", MODEL],
      ["anthropic", "claude-fable-5.2"],
      ["anthropic", "claude-fable-5-2-20261109"],
      ["google-vertex-anthropic", "claude-fable-5-2@default"],
      ["aws-bedrock-anthropic", "anthropic.claude-fable-5-2"],
      ["aws-bedrock-anthropic", "us.anthropic.claude-fable-5-2"],
      ["anthropic", "claude-mythos-5-2"],
    ]
    // when
    const limits = spellings.map(([provider, model]) => resolveActualContextLimit(provider, model, noOptIn))
    // then
    expect(limits).toEqual(spellings.map(() => 1_000_000))
  })

  test("keeps a provider that does not serve 5.2 on its own listed limit", () => {
    // given
    const state = { ...noOptIn, modelContextLimitsCache: new Map([["opengateway/claude-fable-5-2", 345_678]]) }
    // when / then
    expect(resolveActualContextLimit("opengateway", MODEL, state)).toBe(345_678)
  })

  test("routes Copilot to its dotted id and leaves Anthropic's id unchanged", () => {
    // given / when / then
    expect(transformModelForProvider("github-copilot", MODEL)).toBe("claude-fable-5.2")
    expect(transformModelForProvider("anthropic", MODEL)).toBe(MODEL)
  })
})
