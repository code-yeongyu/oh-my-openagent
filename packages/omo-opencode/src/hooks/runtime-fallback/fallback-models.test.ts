import { afterEach, describe, expect, test } from "bun:test"

import {
  getFallbackModelSettingsForSession,
  getFallbackModelsForSession,
  getRawFallbackModels,
} from "./fallback-models"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("runtime-fallback fallback-models", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
  })

  test("uses category fallback_models when session category is registered", () => {
    //#given
    const sessionID = "ses_runtime_fallback_category"
    SessionCategoryRegistry.register(sessionID, "quick")
    const pluginConfig = unsafeTestValue({
      categories: {
        quick: {
          fallback_models: ["openai/gpt-5.5", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession(sessionID, undefined, pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.5", "anthropic/claude-opus-4-7"])
  })

  test("uses entries after the primary model in a category model chain", () => {
    //#given
    const sessionID = "ses_runtime_fallback_category_models"
    SessionCategoryRegistry.register(sessionID, "quick")
    const pluginConfig = unsafeTestValue({
      categories: {
        quick: {
          models: [
            "openai/gpt-5.6",
            { model: "openai/gpt-5.5", reasoning: "high" },
            "anthropic/claude-opus-4-7",
          ],
          fallback_models: ["google/gemini-3-pro"],
        },
      },
    })

    //#when
    const result = getRawFallbackModels(sessionID, undefined, pluginConfig)

    //#then
    expect(result).toEqual([
      { model: "openai/gpt-5.5", reasoning: "high" },
      "anthropic/claude-opus-4-7",
    ])
  })

  test("per-rung legacy reasoning overrides category canonical reasoning", () => {
    //#given
    const sessionID = "ses_runtime_fallback_rung_reasoning"
    SessionCategoryRegistry.register(sessionID, "quick")
    const pluginConfig = unsafeTestValue({
      categories: {
        quick: {
          reasoning: "low",
          models: [
            "openai/gpt-5.6",
            { model: "openai/gpt-5.5", reasoningEffort: "high" },
          ],
        },
      },
    })

    //#when
    const result = getFallbackModelSettingsForSession(
      sessionID,
      undefined,
      pluginConfig,
      "openai/gpt-5.5",
    )

    //#then
    expect(result).toMatchObject({ model: "openai/gpt-5.5", reasoningEffort: "high" })
    expect(result?.reasoning).toBeUndefined()
  })

  test("finds variant rung settings from the base model identity", () => {
    const pluginConfig = unsafeTestValue({
      agents: {
        oracle: {
          models: [
            "openai/gpt-5.6",
            { model: "openai/gpt-5.5", variant: "high", temperature: 0.3 },
          ],
        },
      },
    })

    const result = getFallbackModelSettingsForSession(
      "ses_runtime_fallback_variant_identity",
      "oracle",
      pluginConfig,
      "openai/gpt-5.5",
    )

    expect(result).toMatchObject({ model: "openai/gpt-5.5", variant: "high", temperature: 0.3 })
  })

  test("inherits canonical category max_tokens for a fallback rung", () => {
    //#given
    const sessionID = "ses_runtime_fallback_category_max_tokens"
    SessionCategoryRegistry.register(sessionID, "quick")
    const pluginConfig = unsafeTestValue({
      categories: {
        quick: {
          models: ["openai/gpt-5.6", "openai/gpt-5.5"],
          max_tokens: 2048,
        },
      },
    })

    //#when
    const result = getFallbackModelSettingsForSession(
      sessionID,
      undefined,
      pluginConfig,
      "openai/gpt-5.5",
    )

    //#then
    expect(result?.maxTokens).toBe(2048)
  })

  test("inherits legacy agent providerOptions for a fallback rung", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        oracle: {
          models: ["openai/gpt-5.6", "openai/gpt-5.5"],
          providerOptions: { serviceTier: "priority" },
        },
      },
    })

    //#when
    const result = getFallbackModelSettingsForSession(
      "ses_runtime_fallback_agent_provider_options",
      "oracle",
      pluginConfig,
      "openai/gpt-5.5",
    )

    //#then
    expect(result?.provider_options).toEqual({ serviceTier: "priority" })
  })

  test("uses the fallback index for repeated models with distinct settings", () => {
    const pluginConfig = unsafeTestValue({
      agents: {
        oracle: {
          models: [
            "openai/gpt-5.6",
            { model: "openai/gpt-5.5", reasoning: "high", temperature: 0.3 },
            { model: "openai/gpt-5.5", reasoning: "low", temperature: 0.2 },
          ],
        },
      },
    })

    const result = getFallbackModelSettingsForSession(
      "ses_runtime_fallback_repeated_model",
      "oracle",
      pluginConfig,
      "openai/gpt-5.5",
      1,
    )

    expect(result?.reasoning).toBe("low")
    expect(result?.temperature).toBe(0.2)
  })

  test("uses agent-specific fallback_models when agent is resolved", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        oracle: {
          fallback_models: ["openai/gpt-5.5", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_agent", "oracle", pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.5", "anthropic/claude-opus-4-7"])
  })

  test("uses entries after the primary model in an agent model chain", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        oracle: {
          models: ["openai/gpt-5.6", "openai/gpt-5.5"],
          fallback_models: ["anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_agent_models", "oracle", pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.5"])
  })

  test("uses the canonical model chain from an agent category", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        oracle: { category: "deep" },
      },
      categories: {
        deep: {
          models: ["openai/gpt-5.6", "anthropic/claude-opus-4-7"],
          fallback_models: ["google/gemini-3-pro"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_agent_category", "oracle", pluginConfig)

    //#then
    expect(result).toEqual(["anthropic/claude-opus-4-7"])
  })

  test("a single-entry canonical model chain suppresses legacy fallback_models", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        oracle: {
          models: ["openai/gpt-5.6"],
          fallback_models: ["anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_single_model", "oracle", pluginConfig)

    //#then
    expect(result).toEqual([])
  })

  test("inherits prometheus fallback_models for a replaced plan agent by default", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        plan: {},
        prometheus: {
          fallback_models: ["openai/gpt-5.5", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_plan", "plan", pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.5", "anthropic/claude-opus-4-7"])
  })

  test("inherits the prometheus canonical model chain for a replaced plan agent", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        plan: {},
        prometheus: {
          models: ["anthropic/claude-fable-5", "opencode-go/kimi-k3"],
          fallback_models: ["openai/gpt-5.6-sol"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_plan_models", "plan", pluginConfig)

    //#then
    expect(result).toEqual(["opencode-go/kimi-k3"])
  })

  test("uses explicit plan fallback_models before prometheus inheritance", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        plan: {
          fallback_models: ["openai/gpt-5.4"],
        },
        prometheus: {
          fallback_models: ["openai/gpt-5.5"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_plan", "plan", pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.4"])
  })

  test("explicit empty plan fallback_models suppresses prometheus inheritance", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        plan: {
          fallback_models: [],
        },
        prometheus: {
          fallback_models: ["openai/gpt-5.5"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_plan", "plan", pluginConfig)

    //#then
    expect(result).toEqual([])
  })

  test.each([
    { planner_enabled: false },
    { replace_plan: false },
    { disabled: true },
  ])("does not inherit prometheus fallback_models when plan replacement is disabled: %#", (sisyphusAgent) => {
    //#given
    const pluginConfig = unsafeTestValue({
      sisyphus_agent: sisyphusAgent,
      agents: {
        plan: {},
        prometheus: {
          fallback_models: ["openai/gpt-5.5"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_plan", "plan", pluginConfig)

    //#then
    expect(result).toEqual([])
  })

  test("does not fall back to another agent chain when agent cannot be resolved", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        sisyphus: {
          fallback_models: ["quotio/gpt-5.5", "quotio/glm-5", "quotio/kimi-k2.5"],
        },
        oracle: {
          fallback_models: ["openai/gpt-5.5", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_unknown", undefined, pluginConfig)

    //#then
    expect(result).toEqual([])
  })
})
