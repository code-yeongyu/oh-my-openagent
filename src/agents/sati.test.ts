import { describe, expect, test } from "bun:test"
import { createSatiAgent, SATI_PROMPT_METADATA } from "./sati"

describe("createSatiAgent", () => {
  //#given a Claude model
  //#when creating the agent
  //#then it should return valid config with thinking enabled
  test("returns AgentConfig with thinking for Claude models", () => {
    const model = "anthropic/claude-opus-4-6"

    const config = createSatiAgent(model)

    expect(config.model).toBe(model)
    expect(config.mode).toBe("subagent")
    expect(config.temperature).toBe(0.1)
    expect(config.thinking).toEqual({ type: "enabled", budgetTokens: 10000 })
    expect(config.reasoningEffort).toBeUndefined()
  })

  //#given a GPT model
  //#when creating the agent
  //#then it should return config with reasoningEffort
  test("returns AgentConfig with reasoningEffort for GPT models", () => {
    const model = "openai/gpt-5.2"

    const config = createSatiAgent(model)

    expect(config.model).toBe(model)
    expect(config.reasoningEffort).toBe("medium")
    expect(config.thinking).toBeUndefined()
  })

  //#given the factory function
  //#when checking static mode
  //#then it should be "subagent" (explicitly invokable only, not selectable in menu)
  test("has subagent mode", () => {
    expect(createSatiAgent.mode).toBe("subagent")
  })

  //#given a model
  //#when creating the agent
  //#then both task and delegate_agent are denied (Sati is self-contained)
  test("denies task and delegate_agent for self-contained execution", () => {
    const config = createSatiAgent("anthropic/claude-opus-4-6")

    expect(config.permission).toBeDefined()
    expect(config.permission?.task).toBe("deny")
    expect(config.permission?.delegate_agent).toBe("deny")
  })

  //#given a model
  //#when creating the agent
  //#then prompt should contain frontend-specialist keywords
  test("prompt contains frontend-specialist keywords", () => {
    const config = createSatiAgent("anthropic/claude-opus-4-6")

    const prompt = config.prompt
    const hasFrontendKeyword =
      prompt.includes("FRONTEND") ||
      prompt.includes("COMPONENT") ||
      prompt.includes("REACT")
    expect(hasFrontendKeyword).toBe(true)
  })

  //#given a model
  //#when creating the agent
  //#then config should include all 7 new frontend skills plus playwright (8 total)
  test("includes all 7 new frontend skills plus playwright (8 total)", () => {
    const config = createSatiAgent("anthropic/claude-opus-4-6")
    const skills = (config as Record<string, unknown>).skills as string[]

    expect(skills).toContain("react-nextjs-patterns")
    expect(skills).toContain("svelte-sveltekit-patterns")
    expect(skills).toContain("frontend-a11y")
    expect(skills).toContain("frontend-perf")
    expect(skills).toContain("frontend-testing")
    expect(skills).toContain("frontend-state-data")
    expect(skills).toContain("frontend-build-tooling")
    expect(skills).toContain("playwright")
    expect(skills).toHaveLength(8)
  })

  //#given a model
  //#when creating the agent
  //#then description should identify it as Sati and a frontend specialist
  test("has correct description", () => {
    const config = createSatiAgent("anthropic/claude-opus-4-6")

    expect(config.description).toContain("Sati")
    expect(config.description).toContain("frontend")
  })
})

describe("SATI_PROMPT_METADATA", () => {
  //#given the metadata
  //#then it should have specialist category and expensive cost
  test("has correct category and cost", () => {
    expect(SATI_PROMPT_METADATA.category).toBe("specialist")
    expect(SATI_PROMPT_METADATA.cost).toBe("EXPENSIVE")
  })

  //#given the metadata
  //#then it should have frontend-related triggers
  test("has frontend-related triggers", () => {
    expect(SATI_PROMPT_METADATA.triggers.length).toBeGreaterThanOrEqual(3)
    const domains = SATI_PROMPT_METADATA.triggers.map((t) => t.domain)
    const hasFrontendDomain = domains.some(
      (d) =>
        d.toLowerCase().includes("frontend") ||
        d.toLowerCase().includes("ui") ||
        d.toLowerCase().includes("component") ||
        d.toLowerCase().includes("web")
    )
    expect(hasFrontendDomain).toBe(true)
  })

  //#given the metadata
  //#then it should have promptAlias
  test("has promptAlias", () => {
    expect(SATI_PROMPT_METADATA.promptAlias).toBe("Sati")
  })

  //#given the metadata
  //#then keyTrigger should mention frontend or component
  test("has keyTrigger mentioning frontend or component", () => {
    const keyTrigger = SATI_PROMPT_METADATA.keyTrigger ?? ""
    const lower = keyTrigger.toLowerCase()
    expect(lower.includes("frontend") || lower.includes("component")).toBe(true)
  })

  //#given the metadata
  //#then it should have useWhen and avoidWhen lists
  test("has useWhen and avoidWhen lists", () => {
    expect(SATI_PROMPT_METADATA.useWhen?.length).toBeGreaterThan(0)
    expect(SATI_PROMPT_METADATA.avoidWhen?.length).toBeGreaterThan(0)
  })
})
