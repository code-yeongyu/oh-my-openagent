import { describe, test, expect } from "bun:test"
import { createCipherAgent, CIPHER_PROMPT_METADATA } from "./cipher"

describe("createCipherAgent", () => {
  //#given a Claude model
  //#when creating the agent
  //#then it should return valid config with thinking enabled
  test("returns AgentConfig with thinking for Claude models", () => {
    const model = "anthropic/claude-opus-4-6"

    const config = createCipherAgent(model)

    expect(config.model).toBe(model)
    expect(config.mode).toBe("all")
    expect(config.temperature).toBe(0.1)
    expect(config.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(config.reasoningEffort).toBeUndefined()
  })

  //#given a GPT model
  //#when creating the agent
  //#then it should return config with reasoningEffort
  test("returns AgentConfig with reasoningEffort for GPT models", () => {
    const model = "openai/gpt-5.2"

    const config = createCipherAgent(model)

    expect(config.model).toBe(model)
    expect(config.reasoningEffort).toBe("medium")
    expect(config.thinking).toBeUndefined()
  })

  //#given the factory function
  //#when checking static mode
  //#then it should be "all" (selectable in menu AND available as subagent)
  test("has all mode", () => {
    expect(createCipherAgent.mode).toBe("all")
  })

  //#given a model
  //#when creating the agent
  //#then call_omo_agent denied but task allowed for code generation delegation
  test("denies call_omo_agent but allows task for delegation", () => {
    const config = createCipherAgent("anthropic/claude-opus-4-6")

    expect(config.permission).toBeDefined()
    expect(config.permission!["task"]).toBeUndefined()
    expect(config.permission!["call_omo_agent"]).toBe("deny")
  })

  //#given a model
  //#when creating the agent
  //#then prompt should contain code generation delegation instructions
  test("prompt contains delegation instructions for language experts", () => {
    const config = createCipherAgent("anthropic/claude-opus-4-6")

    expect(config.prompt).toContain("CODE GENERATION DELEGATION")
    expect(config.prompt).toContain("DELEGATE")
    expect(config.prompt).toContain("language expert")
    expect(config.prompt).toContain("task(")
  })

  //#given a model
  //#when creating the agent
  //#then config should include all 5 DSL skills
  test("includes all DSL skills for skill-based knowledge injection", () => {
    const config = createCipherAgent("anthropic/claude-opus-4-6")
    const skills = (config as Record<string, unknown>).skills as string[]

    expect(skills).toContain("dsl-core")
    expect(skills).toContain("dsl-grammar")
    expect(skills).toContain("dsl-codegen")
    expect(skills).toContain("dsl-metamodel")
    expect(skills).toContain("dsl-tooling")
    expect(skills).toHaveLength(5)
  })

  //#given a model
  //#when creating the agent
  //#then description should identify it as DSL specialist
  test("has correct description", () => {
    const config = createCipherAgent("anthropic/claude-opus-4-6")

    expect(config.description).toContain("DSL")
    expect(config.description).toContain("Cipher")
  })
})

describe("CIPHER_PROMPT_METADATA", () => {
  //#given the metadata
  //#then it should have specialist category and expensive cost
  test("has correct category and cost", () => {
    expect(CIPHER_PROMPT_METADATA.category).toBe("specialist")
    expect(CIPHER_PROMPT_METADATA.cost).toBe("EXPENSIVE")
  })

  //#given the metadata
  //#then it should have DSL-related triggers
  test("has DSL-related triggers", () => {
    expect(CIPHER_PROMPT_METADATA.triggers.length).toBeGreaterThanOrEqual(3)
    const domains = CIPHER_PROMPT_METADATA.triggers.map((t) => t.domain)
    expect(domains).toContain("DSL Design")
    expect(domains).toContain("Parser Engineering")
    expect(domains).toContain("Code Generation")
    expect(domains).toContain("Metamodeling")
  })

  //#given the metadata
  //#then it should have promptAlias
  test("has promptAlias", () => {
    expect(CIPHER_PROMPT_METADATA.promptAlias).toBe("Cipher")
  })

  //#given the metadata
  //#then keyTrigger should mention DSL
  test("has keyTrigger mentioning DSL", () => {
    expect(CIPHER_PROMPT_METADATA.keyTrigger).toContain("DSL")
  })

  //#given the metadata
  //#then it should have useWhen and avoidWhen lists
  test("has useWhen and avoidWhen lists", () => {
    expect(CIPHER_PROMPT_METADATA.useWhen!.length).toBeGreaterThan(0)
    expect(CIPHER_PROMPT_METADATA.avoidWhen!.length).toBeGreaterThan(0)
  })
})
