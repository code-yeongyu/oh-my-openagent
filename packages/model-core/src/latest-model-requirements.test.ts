import { describe, expect, test } from "bun:test"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
} from "./model-requirements"
import { resolveModelWithFallback } from "./model-resolver"

// Availability fixtures are independent of the shipped chains: verified catalog rows
// from `omo --offline --list-models` on 2026-09-23 (see the evidence report).
// Resolution must choose those models rather than silently reaching system/default.
describe("current catalog requirement chains", () => {
  test("preserves an Opus 5 fallback when Copilot has no Opus 5.5", () => {
    // given
    const availableModels = new Set(["github-copilot/claude-opus-5"])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: CATEGORY_MODEL_REQUIREMENTS["unspecified-high"].fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result).toMatchObject({
      model: "github-copilot/claude-opus-5",
      variant: "max",
    })
  })

  test("prefers Opus 5.5 when both generations are available", () => {
    // given
    const availableModels = new Set([
      "anthropic/claude-opus-5-5",
      "github-copilot/claude-opus-5",
    ])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.sisyphus.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result).toMatchObject({
      model: "anthropic/claude-opus-5-5",
      variant: "max",
    })
  })

  test("resolves the current GLM fallback without older catalog models", () => {
    // given
    const availableModels = new Set(["opencode-go/glm-5.3"])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.oracle.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result?.model).toBe("opencode-go/glm-5.3")
  })

  test("resolves the non-flash Qwen successor for exploration", () => {
    // given
    const availableModels = new Set(["opencode-go/qwen3.7-plus"])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.explore.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result?.model).toBe("opencode-go/qwen3.7-plus")
  })
})
