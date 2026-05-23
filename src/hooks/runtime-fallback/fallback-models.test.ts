import { afterEach, describe, expect, test } from "bun:test"

import { getFallbackModelsForSession, getRawFallbackModelsForScope } from "./fallback-models"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

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
          fallback_models: ["openai/gpt-5.2", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession(sessionID, undefined, pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.2", "anthropic/claude-opus-4-7"])
  })

  test("uses agent-specific fallback_models when agent is resolved", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        oracle: {
          fallback_models: ["openai/gpt-5.2", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_agent", "oracle", pluginConfig)

    //#then
    expect(result).toEqual(["openai/gpt-5.2", "anthropic/claude-opus-4-7"])
  })

  test("does not fall back to another agent chain when agent cannot be resolved", () => {
    //#given
    const pluginConfig = unsafeTestValue({
      agents: {
        sisyphus: {
          fallback_models: ["quotio/gpt-5.2", "quotio/glm-5", "quotio/kimi-k2.5"],
        },
        oracle: {
          fallback_models: ["openai/gpt-5.2", "anthropic/claude-opus-4-7"],
        },
      },
    })

    //#when
    const result = getFallbackModelsForSession("ses_runtime_fallback_unknown", undefined, pluginConfig)

    //#then
    expect(result).toEqual([])
  })

  describe("scoped fallback_models (#3779)", () => {
    test("ultrawork scope prefers ultrawork.fallback_models over agent-level chain", () => {
      //#given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: ["openai/gpt-5.5"],
            ultrawork: {
              model: "anthropic/claude-opus-4-7",
              variant: "max",
              fallback_models: ["openai/gpt-5.5", "google/gemini-3.1-flash-preview"],
            },
          },
        },
      })

      //#when
      const result = getRawFallbackModelsForScope(
        "ses_ultrawork",
        "sisyphus",
        pluginConfig,
        "ultrawork",
      )

      //#then
      expect(result).toEqual(["openai/gpt-5.5", "google/gemini-3.1-flash-preview"])
    })

    test("ultrawork scope falls through to agent-level fallback_models when ultrawork.fallback_models is unset", () => {
      //#given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: ["openai/gpt-5.5"],
            ultrawork: { model: "anthropic/claude-opus-4-7", variant: "max" },
          },
        },
      })

      //#when
      const result = getRawFallbackModelsForScope(
        "ses_ultrawork_default",
        "sisyphus",
        pluginConfig,
        "ultrawork",
      )

      //#then
      expect(result).toEqual(["openai/gpt-5.5"])
    })

    test("compaction scope prefers compaction.fallback_models over agent-level chain", () => {
      //#given
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: ["openai/gpt-5.5"],
            compaction: {
              model: "google/gemini-3.1-flash-preview",
              fallback_models: ["openai/gpt-5.4"],
            },
          },
        },
      })

      //#when
      const result = getRawFallbackModelsForScope(
        "ses_compaction",
        "sisyphus",
        pluginConfig,
        "compaction",
      )

      //#then
      expect(result).toEqual(["openai/gpt-5.4"])
    })

    test("agent scope ignores scoped fallback_models entirely", () => {
      //#given - prove scope='agent' is unchanged so ordinary session.idle
      //         resolution doesn't accidentally pick up scoped chains.
      const pluginConfig = unsafeTestValue({
        agents: {
          sisyphus: {
            fallback_models: ["openai/gpt-5.5"],
            ultrawork: {
              model: "anthropic/claude-opus-4-7",
              fallback_models: ["should-not-be-used/x"],
            },
          },
        },
      })

      //#when
      const result = getRawFallbackModelsForScope(
        "ses_agent_baseline",
        "sisyphus",
        pluginConfig,
        "agent",
      )

      //#then
      expect(result).toEqual(["openai/gpt-5.5"])
    })
  })
})
