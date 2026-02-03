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
        ultrabrain: { model: "openai/gpt-5.2", variant: "xhigh" },
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
    const message = { variant: "max" }

    // when
    applyAgentVariant(config, "sisyphus", message)

    // then
    expect(message.variant).toBe("max")
  })
})

describe("resolveVariantForModel", () => {
  test("returns agent override variant when configured", () => {
    // given - use a model in sisyphus chain (claude-opus-4-5 has default variant "max")
    // to verify override takes precedence over fallback chain
    const config = {
      agents: {
        sisyphus: { variant: "high" },
      },
    } as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-5" }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBe("high")
  })

  test("returns correct variant for anthropic provider", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-5" }

    // when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // then
    expect(variant).toBe("max")
  })

  test("returns correct variant for openai provider (hephaestus agent)", () => {
    // #given hephaestus has openai/gpt-5.2-codex with variant "medium" in its chain
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "openai", modelID: "gpt-5.2-codex" }

    // #when
    const variant = resolveVariantForModel(config, "hephaestus", model)

    // then
    expect(variant).toBe("medium")
  })

  test("returns undefined for provider not in sisyphus chain", () => {
    // #given openai is not in sisyphus fallback chain anymore
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "openai", modelID: "gpt-5.2" }

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
    const model = { providerID: "anthropic", modelID: "claude-opus-4-5" }

    // when
    const variant = resolveVariantForModel(config, "nonexistent-agent", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns variant for zai-coding-plan provider without variant", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "zai-coding-plan", modelID: "glm-4.7" }

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
    const model = { providerID: "openai", modelID: "gpt-5.2-codex" }

    // when
    const variant = resolveVariantForModel(config, "custom-agent", model)

    // then
    expect(variant).toBe("xhigh")
  })

  test("returns correct variant for oracle agent with openai", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "openai", modelID: "gpt-5.2" }

    // when
    const variant = resolveVariantForModel(config, "oracle", model)

    // then
    expect(variant).toBe("high")
  })

  test("returns correct variant for oracle agent with anthropic", () => {
    // given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-5" }

    // when
    const variant = resolveVariantForModel(config, "oracle", model)

    // then
    expect(variant).toBe("max")
  })

  test("matches model with antigravity- prefix to base model", () => {
    // #given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "antigravity-claude-opus-4-5" }

    // #when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // #then
    expect(variant).toBe("max")
  })

  test("uses user-defined fallback_chain when provided for agent", () => {
    // #given
    const config = {
      agents: {
        sisyphus: {
          fallback_chain: [
            { providers: ["custom-provider"], model: "custom-model", variant: "custom-variant" }
          ]
        }
      }
    } as OhMyOpenCodeConfig
    const model = { providerID: "custom-provider", modelID: "custom-model" }

    // #when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // #then
    expect(variant).toBe("custom-variant")
  })

  test("uses user-defined fallback_chain when provided for category", () => {
    // #given
    const config = {
      agents: {
        "custom-agent": { category: "my-category" }
      },
      categories: {
        "my-category": {
          model: "some/model",
          fallback_chain: [
            { providers: ["google"], model: "gemini-3-pro", variant: "high" }
          ]
        }
      }
    } as OhMyOpenCodeConfig
    const model = { providerID: "google", modelID: "antigravity-gemini-3-pro" }

    // #when
    const variant = resolveVariantForModel(config, "custom-agent", model)

    // #then
    expect(variant).toBe("high")
  })

  test("falls back to agent variant when no fallback chain matches", () => {
    // #given
    const config = {
      agents: {
        "custom-agent": { variant: "fallback-variant" }
      }
    } as OhMyOpenCodeConfig
    const model = { providerID: "unknown-provider", modelID: "unknown-model" }

    // #when
    const variant = resolveVariantForModel(config, "custom-agent", model)

    // #then
    expect(variant).toBe("fallback-variant")
  })

  test("falls back to category variant when no fallback chain matches", () => {
    // #given
    const config = {
      agents: {
        "custom-agent": { category: "my-category" }
      },
      categories: {
        "my-category": {
          model: "some/model",
          variant: "category-fallback-variant"
        }
      }
    } as OhMyOpenCodeConfig
    const model = { providerID: "unknown-provider", modelID: "unknown-model" }

    // #when
    const variant = resolveVariantForModel(config, "custom-agent", model)

    // #then
    expect(variant).toBe("category-fallback-variant")
  })

  // Edge case tests for PR #1307 fix
  test("does not select variant when provider matches but model does not", () => {
    // given
    const config = {
      agents: {
        testAgent: {
          fallback_chain: [
            { providers: ["anthropic"], model: "claude-opus-4", variant: "max" }
          ]
        }
      }
    } as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-sonnet-4" } // Different model

    // when
    const variant = resolveVariantForModel(config, "testAgent", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("selects variant when provider matches and entry has no model", () => {
    // given
    const config = {
      agents: {
        testAgent: {
          fallback_chain: [
            { providers: ["anthropic"], variant: "high" } // No model specified
          ]
        }
      }
    } as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "any-model" }

    // when
    const variant = resolveVariantForModel(config, "testAgent", model)

    // then
    expect(variant).toBe("high")
  })

  test("does not match when modelID is undefined but entry requires model", () => {
    // given
    const config = {
      agents: {
        testAgent: {
          fallback_chain: [
            { providers: ["anthropic"], model: "claude-opus-4", variant: "max" }
          ]
        }
      }
    } as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: undefined } as any // Forced undefined

    // when
    const variant = resolveVariantForModel(config, "testAgent", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("skips mismatched entries and finds later matching entry", () => {
    // given
    const config = {
      agents: {
        testAgent: {
          fallback_chain: [
            { providers: ["anthropic"], model: "claude-opus-4", variant: "max" }, // Wrong model
            { providers: ["anthropic"], model: "claude-sonnet-4", variant: "high" } // Correct
          ]
        }
      }
    } as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-sonnet-4" }

    // when
    const variant = resolveVariantForModel(config, "testAgent", model)

    // then
    expect(variant).toBe("high")
  })

  test("respects model matching for entries with multiple providers", () => {
    // given
    const config = {
      agents: {
        testAgent: {
          fallback_chain: [
            { providers: ["anthropic", "openai"], model: "gpt-4", variant: "high" }
          ]
        }
      }
    } as OhMyOpenCodeConfig
    // Provider matches (anthropic) but model (claude-opus-4) doesn't match gpt-4
    const model = { providerID: "anthropic", modelID: "claude-opus-4" }

    // when
    const variant = resolveVariantForModel(config, "testAgent", model)

    // then
    expect(variant).toBeUndefined()
  })
})
