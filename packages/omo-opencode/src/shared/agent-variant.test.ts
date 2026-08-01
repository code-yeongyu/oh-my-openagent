import { describe, expect, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import {
  applyAgentVariant,
  lowerReasoningForModel,
  resolveAgentVariant,
  resolveVariantForModel,
} from "./agent-variant"

describe("resolveAgentVariant", () => {
  test("returns undefined when agent name missing", () => {
    // given
    const config = {} as OhMyOpenCodeConfig

    // when
    const variant = resolveAgentVariant(config)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns agent reasoning before legacy variant", () => {
    // given
    const config = {
      agents: {
        sisyphus: { reasoning: "high", variant: "low" },
      },
    } as OhMyOpenCodeConfig

    // when
    const variant = resolveAgentVariant(config, "sisyphus")

    // then
    expect(variant).toBe("high")
  })

  test("returns category reasoning before legacy category variant", () => {
    // given
    const config = {
      agents: {
        sisyphus: { category: "ultrabrain" },
      },
      categories: {
        ultrabrain: { model: "openai/gpt-5.5", reasoning: "high", variant: "xhigh" },
      },
    } as OhMyOpenCodeConfig

    // when
    const variant = resolveAgentVariant(config, "sisyphus")

    // then
    expect(variant).toBe("high")
  })
})

describe("lowerReasoningForModel", () => {
  test("lowers a level to variant when the model exposes a matching preset", () => {
    // given
    const model = {
      providerID: "test-provider",
      modelID: "test-model",
      runtimeModel: { variants: { high: {} } },
    }

    // when
    const result = lowerReasoningForModel("high", model)

    // then
    expect(result).toEqual({ variant: "high" })
  })

  test("lowers a level to native reasoning effort without a matching preset", () => {
    // given
    const model = { providerID: "test-provider", modelID: "test-model" }

    // when
    const result = lowerReasoningForModel("high", model)

    // then
    expect(result).toEqual({ reasoningEffort: "high" })
  })

  test("maps off to OpenCode's native none effort", () => {
    // given
    const model = { providerID: "test-provider", modelID: "test-model" }

    // when
    const result = lowerReasoningForModel("off", model)

    // then
    expect(result).toEqual({ reasoningEffort: "none" })
  })

  test("passes a non-level preset token through as variant", () => {
    // given
    const model = { providerID: "test-provider", modelID: "test-model" }

    // when
    const result = lowerReasoningForModel("thinking", model)

    // then
    expect(result).toEqual({ variant: "thinking" })
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
    applyAgentVariant(config, "sisyphus", message, {
      providerID: "test-provider",
      modelID: "test-model",
      runtimeModel: { variants: { low: {} } },
    } as { providerID: string; modelID: string; runtimeModel?: { variants?: { low?: unknown } } })

    // then
    expect(message.variant).toBe("low")
  })

  test("lowers canonical reasoning to reasoningEffort when the selected model has no matching preset", () => {
    // given
    const config = {
      agents: {
        sisyphus: { reasoning: "high" },
      },
    } as OhMyOpenCodeConfig
    const message: { variant?: string; reasoningEffort?: string } = {}

    // when
    applyAgentVariant(config, "sisyphus", message, {
      providerID: "test-provider",
      modelID: "test-model",
    } as { providerID: string; modelID: string; runtimeModel?: { variants?: Record<string, unknown> } })

    // then
    expect(message).toEqual({ reasoningEffort: "high" })
  })

  test("keeps canonical reasoning as variant when the selected model exposes the preset", () => {
    // given
    const config = {
      agents: {
        sisyphus: { reasoning: "high" },
      },
    } as OhMyOpenCodeConfig
    const message: { variant?: string; reasoningEffort?: string } = {}

    // when
    applyAgentVariant(config, "sisyphus", message, {
      providerID: "test-provider",
      modelID: "test-model",
      runtimeModel: { variants: { high: {} } },
    } as { providerID: string; modelID: string; runtimeModel?: { variants?: { high?: unknown } } })

    // then
    expect(message).toEqual({ variant: "high" })
  })

  test("does not override existing variant", () => {
    // given
    const config = {
      agents: {
        sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig
    const message = { variant: "max" }

    // when
    applyAgentVariant(config, "sisyphus", message, {
      providerID: "test-provider",
      modelID: "test-model",
      runtimeModel: { variants: { low: {} } },
    } as { providerID: string; modelID: string; runtimeModel?: { variants?: { low?: unknown } } })

    // then
    expect(message.variant).toBe("max")
  })
})

describe("resolveVariantForModel", () => {
  test("returns agent reasoning before legacy variant and fallback chain metadata", () => {
    // given - use a model in sisyphus chain (claude-opus-5 has default variant "max")
    // to verify the canonical field takes precedence over both legacy sources
    const config = {
      agents: {
        sisyphus: { reasoning: "high", variant: "low" },
      },
    } as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-5" }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBe("high")
  })

  test("returns correct variant for anthropic provider", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-5" }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBe("max")
  })

  test("returns medium for Hephaestus's openai gpt-5.6-sol rung", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "openai", modelID: "gpt-5.6-sol" }

    // when
    const variant = resolveVariantForModel(config, "hephaestus", model)

    // then
    expect(variant).toBe("medium")
  })

  test("returns undefined for gpt-5.5 after its sisyphus rung is removed", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "openai", modelID: "gpt-5.5" }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBeUndefined()
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
    const model = { providerID: "anthropic", modelID: "claude-opus-4-7" }

    // when
    const variant = resolveVariantForModel(config, "nonexistent-agent", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns variant for zai-coding-plan provider without variant", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "zai-coding-plan", modelID: "glm-5" }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns category reasoning before category chain metadata", () => {
    // given
    const config = {
      agents: {
        "custom-agent": { category: "ultrabrain" },
      },
      categories: {
        ultrabrain: { reasoning: "medium" },
      },
    } as OhMyOpenCodeConfig
    const model = { providerID: "openai", modelID: "gpt-5.6-sol" }

    // when
    const variant = resolveVariantForModel(config, "custom-agent", model)

    // then
    expect(variant).toBe("medium")
  })

  test("falls back to category chain when no configured reasoning or variant exists", () => {
    // given
    const config = {
      agents: {
        "custom-agent": { category: "ultrabrain" },
      },
    } as OhMyOpenCodeConfig
    const model = { providerID: "openai", modelID: "gpt-5.6-sol" }

    // when
    const variant = resolveVariantForModel(config, "custom-agent", model)

    // then
    expect(variant).toBe("max")
  })

  test("returns xhigh for oracle's openai GPT-5.6 Sol primary", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "openai", modelID: "gpt-5.6-sol" }

    // when
    const variant = resolveVariantForModel(config, "oracle", model)

    // then
    expect(variant).toBe("xhigh")
  })

  test("returns correct variant for oracle agent with anthropic", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-5" }

    // when
    const variant = resolveVariantForModel(config, "oracle", model)

    // then
    expect(variant).toBe("max")
  })
})
