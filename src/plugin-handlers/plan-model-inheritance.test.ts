import { describe, test, expect } from "bun:test"
import { buildPlanDemoteConfig } from "./plan-model-inheritance"

describe("buildPlanDemoteConfig", () => {
  test("returns only mode when prometheus and plan override are both undefined", () => {
    //#given
    const prometheusConfig = undefined
    const planOverride = undefined

    //#when
    const result = buildPlanDemoteConfig(prometheusConfig, planOverride)

    //#then
    expect(result).toEqual({ mode: "subagent" })
  })

  test("extracts all model settings from prometheus config", () => {
    //#given
    const prometheusConfig = {
      name: "prometheus",
      model: "anthropic/claude-opus-4-6",
      variant: "max",
      mode: "all",
      prompt: "You are Prometheus...",
      permission: { edit: "allow" },
      description: "Plan agent (Prometheus)",
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
    const result = buildPlanDemoteConfig(prometheusConfig, undefined)

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

  test("plan override takes priority over prometheus for all model settings", () => {
    //#given
    const prometheusConfig = {
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
    const result = buildPlanDemoteConfig(prometheusConfig, planOverride)

    //#then
    expect(result.model).toBe("openai/gpt-5.2")
    expect(result.variant).toBe("high")
    expect(result.temperature).toBe(0.5)
    expect(result.reasoningEffort).toBe("low")
  })

  test("falls back to prometheus when plan override has partial settings", () => {
    //#given
    const prometheusConfig = {
      model: "anthropic/claude-opus-4-6",
      variant: "max",
      temperature: 0.1,
      reasoningEffort: "high",
    }
    const planOverride = {
      model: "openai/gpt-5.2",
    }

    //#when
    const result = buildPlanDemoteConfig(prometheusConfig, planOverride)

    //#then - plan model wins, rest inherits from prometheus
    expect(result.model).toBe("openai/gpt-5.2")
    expect(result.variant).toBe("max")
    expect(result.temperature).toBe(0.1)
    expect(result.reasoningEffort).toBe("high")
  })

  test("skips undefined values from both sources", () => {
    //#given
    const prometheusConfig = {
      model: "anthropic/claude-opus-4-6",
    }

    //#when
    const result = buildPlanDemoteConfig(prometheusConfig, undefined)

    //#then
    expect(result).toEqual({ mode: "subagent", model: "anthropic/claude-opus-4-6" })
    expect(Object.keys(result)).toEqual(["mode", "model"])
  })
})
