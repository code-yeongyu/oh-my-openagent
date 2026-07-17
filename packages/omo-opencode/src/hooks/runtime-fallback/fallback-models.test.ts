import { afterEach, describe, expect, test } from "bun:test"

import { getFallbackModelsForSession } from "./fallback-models"
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
