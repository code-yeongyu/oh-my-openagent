import { describe, expect, test } from "bun:test"
import { buildPlanDemoteConfig } from "./plan-model-inheritance"

describe("buildPlanDemoteConfig", () => {
  test("returns only mode when oracle and plan override are both undefined", () => {
    //#given
    const oracleConfig = undefined
    const planOverride = undefined

    //#when
    const result = buildPlanDemoteConfig(oracleConfig, planOverride)

    //#then
    expect(result).toEqual({ mode: "subagent" })
  })

  test("extracts all model settings from oracle config", () => {
    //#given
    const oracleConfig = {
      name: "oracle",
      model: "anthropic/claude-opus-4-6",
      variant: "max",
      mode: "all",
      prompt: "You are Oracle...",
      permission: { edit: "allow" },
      description: "Plan agent (Oracle)",
      color: "#FF5722",
      temperature: 0.1,
      top_p: 0.95,
      maxTokens: 32000,
      thinking: { type: "enabled", budgetTokens: 10000 },
      reasoningEffort: "high",
      textVerbosity: "medium",
      providerOptions: { key: "value" },
    }

    //#when
    const result = buildPlanDemoteConfig(oracleConfig, undefined)

    //#then - picks model settings, NOT prompt/permission/description/color/name/mode
    expect(result.mode).toBe("subagent")
    expect(result.model).toBe("anthropic/claude-opus-4-6")
    expect(result.variant).toBe("max")
    expect(result.temperature).toBe(0.1)
    expect(result.top_p).toBe(0.95)
    expect(result.maxTokens).toBe(32000)
    expect(result.thinking).toEqual({ type: "enabled", budgetTokens: 10000 })
    expect(result.reasoningEffort).toBe("high")
    expect(result.textVerbosity).toBe("medium")
    expect(result.providerOptions).toEqual({ key: "value" })
    expect(result.prompt).toBeUndefined()
    expect(result.permission).toBeUndefined()
    expect(result.description).toBeUndefined()
    expect(result.color).toBeUndefined()
    expect(result.name).toBeUndefined()
  })

  test("plan override takes priority over oracle for all model settings", () => {
    //#given
    const oracleConfig = {
      model: "anthropic/claude-opus-4-6",
      variant: "max",
      temperature: 0.1,
      reasoningEffort: "high",
    }
    const planOverride = {
      model: "openai/gpt-5.2",
      variant: "high",
      temperature: 0.5,
      reasoningEffort: "low",
    }

    //#when
    const result = buildPlanDemoteConfig(oracleConfig, planOverride)

    //#then
    expect(result.model).toBe("openai/gpt-5.2")
    expect(result.variant).toBe("high")
    expect(result.temperature).toBe(0.5)
    expect(result.reasoningEffort).toBe("low")
  })

  test("falls back to oracle when plan override has partial settings", () => {
    //#given
    const oracleConfig = {
      model: "anthropic/claude-opus-4-6",
      variant: "max",
      temperature: 0.1,
      reasoningEffort: "high",
    }
    const planOverride = {
      model: "openai/gpt-5.2",
    }

    //#when
    const result = buildPlanDemoteConfig(oracleConfig, planOverride)

    //#then - plan model wins, rest inherits from oracle
    expect(result.model).toBe("openai/gpt-5.2")
    expect(result.variant).toBe("max")
    expect(result.temperature).toBe(0.1)
    expect(result.reasoningEffort).toBe("high")
  })

  test("skips undefined values from both sources", () => {
    //#given
    const oracleConfig = {
      model: "anthropic/claude-opus-4-6",
    }

    //#when
    const result = buildPlanDemoteConfig(oracleConfig, undefined)

    //#then
    expect(result).toEqual({ mode: "subagent", model: "anthropic/claude-opus-4-6" })
    expect(Object.keys(result)).toEqual(["mode", "model"])
  })
})
