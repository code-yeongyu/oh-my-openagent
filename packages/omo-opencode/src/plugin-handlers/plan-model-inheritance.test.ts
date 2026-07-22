import { describe, test, expect } from "bun:test"
import { applyInheritFromSisyphus, buildPlanDemoteConfig } from "./plan-model-inheritance"

describe("buildPlanDemoteConfig", () => {
  test("returns only mode when prometheus and plan override are both undefined", () => {
    //#given
    const prometheusConfig = undefined
    const planOverride = undefined

    //#when
    const result = buildPlanDemoteConfig(prometheusConfig, planOverride)

    //#then
    expect(result).toEqual({ mode: "subagent", hidden: true })
  })

  test("extracts all model settings from prometheus config", () => {
    //#given
    const prometheusConfig = {
      name: "prometheus",
      model: "anthropic/claude-opus-4-7",
      variant: "max",
      mode: "primary",
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
      fallback_models: [{ model: "openai/gpt-5.5", variant: "high" }, "opencode-go/glm-5.2"],
    }

    //#when
    const result = buildPlanDemoteConfig(prometheusConfig, undefined)

    //#then - picks model settings, NOT prompt/permission/description/color/name/mode
    expect(result.mode).toBe("subagent")
    expect(result.model).toBe("anthropic/claude-opus-4-7")
    expect(result.variant).toBe("max")
    expect(result.temperature).toBe(0.1)
    expect(result.top_p).toBe(0.95)
    expect(result.maxTokens).toBe(32000)
    expect(result.thinking).toEqual({ type: "enabled", budgetTokens: 10000 })
    expect(result.reasoningEffort).toBe("high")
    expect(result.textVerbosity).toBe("medium")
    expect(result.providerOptions).toEqual({ key: "value" })
    expect(result.fallback_models).toEqual([
      { model: "openai/gpt-5.5", variant: "high" },
      "opencode-go/glm-5.2",
    ])
    expect(result.prompt).toBeUndefined()
    expect(result.permission).toBeUndefined()
    expect(result.description).toBeUndefined()
    expect(result.color).toBeUndefined()
    expect(result.name).toBeUndefined()
  })

  test("plan override takes priority over prometheus for all model settings", () => {
    //#given
    const prometheusConfig = {
      model: "anthropic/claude-opus-4-7",
      variant: "max",
      temperature: 0.1,
      reasoningEffort: "high",
      fallback_models: ["openai/gpt-5.5"],
    }
    const planOverride = {
      model: "openai/gpt-5.4",
      variant: "high",
      temperature: 0.5,
      reasoningEffort: "low",
      fallback_models: [{ model: "opencode-go/glm-5.2" }],
    }

    //#when
    const result = buildPlanDemoteConfig(prometheusConfig, planOverride)

    //#then
    expect(result.model).toBe("openai/gpt-5.4")
    expect(result.variant).toBe("high")
    expect(result.temperature).toBe(0.5)
    expect(result.reasoningEffort).toBe("low")
    expect(result.fallback_models).toEqual([{ model: "opencode-go/glm-5.2" }])
  })

  test("falls back to prometheus when plan override has partial settings", () => {
    //#given
    const prometheusConfig = {
      model: "anthropic/claude-opus-4-7",
      variant: "max",
      temperature: 0.1,
      reasoningEffort: "high",
    }
    const planOverride = {
      model: "openai/gpt-5.4",
    }

    //#when
    const result = buildPlanDemoteConfig(prometheusConfig, planOverride)

    //#then - plan model wins, rest inherits from prometheus
    expect(result.model).toBe("openai/gpt-5.4")
    expect(result.variant).toBe("max")
    expect(result.temperature).toBe(0.1)
    expect(result.reasoningEffort).toBe("high")
  })

  test("skips undefined values from both sources", () => {
    //#given
    const prometheusConfig = {
      model: "anthropic/claude-opus-4-7",
    }

    //#when
    const result = buildPlanDemoteConfig(prometheusConfig, undefined)

    //#then
    expect(result).toEqual({ mode: "subagent", hidden: true, model: "anthropic/claude-opus-4-7" })
    expect(Object.keys(result)).toEqual(["mode", "hidden", "model"])
  })
})

describe("applyInheritFromSisyphus", () => {
  const eligible = ["oracle", "librarian", "explore"]
  const noBlock = () => false
  const noOverride = () => undefined

  test("no-op when sisyphus settings are undefined", () => {
    //#given an eligible agent with its own resolved model
    const agents: Record<string, { model?: string; variant?: string }> = { oracle: { model: "cheap/oracle" } }

    //#when inheritance runs without any sisyphus settings
    applyInheritFromSisyphus({ agents, sisyphus: undefined, eligibleAgentNames: eligible, isBlocked: noBlock, getUserOverride: noOverride })

    //#then nothing changes
    expect(agents.oracle).toEqual({ model: "cheap/oracle" })
  })

  test("no-op when sisyphus has no model", () => {
    //#given a sisyphus config that carries only a variant
    const agents: Record<string, { model?: string; variant?: string }> = { oracle: { model: "cheap/oracle", variant: "fast" } }

    //#when inheritance runs
    applyInheritFromSisyphus({ agents, sisyphus: { variant: "max" }, eligibleAgentNames: eligible, isBlocked: noBlock, getUserOverride: noOverride })

    //#then the agent keeps its own model and variant
    expect(agents.oracle).toEqual({ model: "cheap/oracle", variant: "fast" })
  })

  test("copies sisyphus model and variant onto eligible agents", () => {
    //#given eligible agents with cheap resolved models
    const agents: Record<string, { model?: string; variant?: string }> = {
      oracle: { model: "cheap/oracle" },
      librarian: { model: "cheap/librarian", variant: "fast" },
    }

    //#when sisyphus provides a model and variant
    applyInheritFromSisyphus({ agents, sisyphus: { model: "anthropic/claude-opus-4-7", variant: "max" }, eligibleAgentNames: eligible, isBlocked: noBlock, getUserOverride: noOverride })

    //#then both agents adopt the sisyphus model and variant
    expect(agents.oracle).toEqual({ model: "anthropic/claude-opus-4-7", variant: "max" })
    expect(agents.librarian).toEqual({ model: "anthropic/claude-opus-4-7", variant: "max" })
  })

  test("clears a stale variant when sisyphus has a model but no variant", () => {
    //#given an eligible agent with an existing variant
    const agents: Record<string, { model?: string; variant?: string }> = { oracle: { model: "cheap/oracle", variant: "fast" } }

    //#when sisyphus provides a model without a variant
    applyInheritFromSisyphus({ agents, sisyphus: { model: "openai/gpt-5.5" }, eligibleAgentNames: eligible, isBlocked: noBlock, getUserOverride: noOverride })

    //#then the model is inherited and the stale variant is cleared
    expect(agents.oracle.model).toBe("openai/gpt-5.5")
    expect("variant" in agents.oracle).toBe(false)
  })

  test("skips an agent whose model the user set explicitly", () => {
    //#given the user pinned oracle to a specific model
    const agents: Record<string, { model?: string }> = { oracle: { model: "user/pinned" } }

    //#when inheritance runs with that override visible
    applyInheritFromSisyphus({ agents, sisyphus: { model: "anthropic/claude-opus-4-7" }, eligibleAgentNames: eligible, isBlocked: noBlock, getUserOverride: (name) => (name === "oracle" ? { model: "user/pinned" } : undefined) })

    //#then the explicit model wins
    expect(agents.oracle.model).toBe("user/pinned")
  })

  test("skips an agent the user pointed at a category", () => {
    //#given oracle derives its model from a category
    const agents: Record<string, { model?: string }> = { oracle: { model: "category/derived" } }

    //#when inheritance runs with that category override visible
    applyInheritFromSisyphus({ agents, sisyphus: { model: "anthropic/claude-opus-4-7" }, eligibleAgentNames: eligible, isBlocked: noBlock, getUserOverride: (name) => (name === "oracle" ? { category: "quick" } : undefined) })

    //#then the category choice is preserved
    expect(agents.oracle.model).toBe("category/derived")
  })

  test("skips a blocked agent but still inherits into the others", () => {
    //#given a provider-locked agent alongside a plain one
    const agents: Record<string, { model?: string }> = { hephaestus: { model: "openai/gpt-5.6" }, oracle: { model: "cheap/oracle" } }

    //#when hephaestus is reported as blocked
    applyInheritFromSisyphus({ agents, sisyphus: { model: "anthropic/claude-opus-4-7" }, eligibleAgentNames: ["hephaestus", "oracle"], isBlocked: (name) => name === "hephaestus", getUserOverride: noOverride })

    //#then the blocked agent is untouched and the plain one inherits
    expect(agents.hephaestus.model).toBe("openai/gpt-5.6")
    expect(agents.oracle.model).toBe("anthropic/claude-opus-4-7")
  })

  test("ignores eligible names that are absent from the agent map", () => {
    //#given only oracle is present
    const agents: Record<string, { model?: string }> = { oracle: { model: "cheap/oracle" } }

    //#when explore is eligible but missing
    const run = () =>
      applyInheritFromSisyphus({ agents, sisyphus: { model: "anthropic/claude-opus-4-7" }, eligibleAgentNames: ["oracle", "explore"], isBlocked: noBlock, getUserOverride: noOverride })

    //#then it does not throw and only oracle is affected
    expect(run).not.toThrow()
    expect(agents.oracle.model).toBe("anthropic/claude-opus-4-7")
    expect(agents).not.toHaveProperty("explore")
  })

  test("never touches agents outside the eligible set", () => {
    //#given a custom agent that is not eligible
    const agents: Record<string, { model?: string }> = { oracle: { model: "cheap/oracle" }, "custom-agent": { model: "user/custom" } }

    //#when only oracle is eligible
    applyInheritFromSisyphus({ agents, sisyphus: { model: "anthropic/claude-opus-4-7" }, eligibleAgentNames: ["oracle"], isBlocked: noBlock, getUserOverride: noOverride })

    //#then the custom agent is left alone
    expect(agents.oracle.model).toBe("anthropic/claude-opus-4-7")
    expect(agents["custom-agent"].model).toBe("user/custom")
  })
})
