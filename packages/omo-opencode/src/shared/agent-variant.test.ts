import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS } from "@oh-my-opencode/model-core";
import { describe, expect, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import { applyAgentVariant, resolveAgentVariant, resolveVariantForModel } from "./agent-variant"

describe("resolveAgentVariant", () => {
  test("returns undefined when agent name missing", () => {
    // given
    const config = {} as OhMyOpenCodeConfig

    // when
    const variant = resolveAgentVariant(config)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns agent override variant", () => {
    // given
    const config = {
      agents: {
        sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig

    // when
    const variant = resolveAgentVariant(config, "sisyphus")

    // then
    expect(variant).toBe("low")
  })

  test("returns category variant when agent uses category", () => {
    // given
    const config = {
      agents: {
        sisyphus: { category: "ultrabrain" },
      },
      categories: {
        ultrabrain: { model: "openai/gpt-5.5", variant: SUPPORTED_VARIANTS.XHIGH },
      },
    } as OhMyOpenCodeConfig

    // when
    const variant = resolveAgentVariant(config, "sisyphus")

    // then
    expect(variant).toBe("xhigh")
  })
})

describe("applyAgentVariant", () => {
  test("sets variant when message is undefined", () => {
    // given
    const config = {
      agents: {
        sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig
    const message: { variant?: string } = {}

    // when
    applyAgentVariant(config, "sisyphus", message)

    // then
    expect(message.variant).toBe("low")
  })

  test("does not override existing variant", () => {
    // given
    const config = {
      agents: {
        sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig
    const message = { variant: SUPPORTED_VARIANTS.MAX }

    // when
    applyAgentVariant(config, "sisyphus", message)

    // then
    expect(message.variant).toBe("max")
  })
})

describe("resolveVariantForModel", () => {
  test("returns agent override variant when configured", () => {
    // given - use a model in sisyphus chain (claude-opus-4-7 has default variant "max")
    // to verify override takes precedence over fallback chain
    const config = {
      agents: {
        sisyphus: { variant: SUPPORTED_VARIANTS.HIGH },
      },
    } as OhMyOpenCodeConfig
    const model = { providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBe("high")
  })

  test("returns correct variant for anthropic provider", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBe("max")
  })

  test("returns correct variant for openai provider (hephaestus agent)", () => {
    // #given hephaestus has openai/gpt-5.5 with variant "medium" in its chain
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 }

    // #when
    const variant = resolveVariantForModel(config, "hephaestus", model)

    // then
    expect(variant).toBe("medium")
  })

  test("returns medium for openai/gpt-5.5 in sisyphus chain", () => {
    // #given openai/gpt-5.5 is now in sisyphus fallback chain with variant medium
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBe("medium")
  })

  test("returns undefined for provider not in chain", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "unknown-provider", modelID: "some-model" }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns undefined for unknown agent", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 }

    // when
    const variant = resolveVariantForModel(config, "nonexistent-agent", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns variant for zai-coding-plan provider without variant", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: SUPPORTED_PROVIDERS.ZAI_CODING_PLAN, modelID: SUPPORTED_MODELS.GLM_5 }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("falls back to category chain when agent has no requirement", () => {
    // given
    const config = {
      agents: {
        "custom-agent": { category: "ultrabrain" },
      },
    } as OhMyOpenCodeConfig
    const model = { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 }

    // when
    const variant = resolveVariantForModel(config, "custom-agent", model)

    // then
    expect(variant).toBe("xhigh")
  })

  test("returns correct variant for oracle agent with openai", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: SUPPORTED_PROVIDERS.OPENAI, modelID: SUPPORTED_MODELS.GPT_5_5 }

    // when
    const variant = resolveVariantForModel(config, "oracle", model)

    // then
    expect(variant).toBe("high")
  })

  test("returns correct variant for oracle agent with anthropic", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: SUPPORTED_PROVIDERS.ANTHROPIC, modelID: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 }

    // when
    const variant = resolveVariantForModel(config, "oracle", model)

    // then
    expect(variant).toBe("max")
  })
})
