import { describe, test, expect } from "bun:test"
import { createSherlockAgent, SHERLOCK_PROMPT_METADATA } from "./sherlock"

describe("Sherlock Debug Agent", () => {
  // #given a sherlock agent configuration
  const agent = createSherlockAgent()

  test("should use GPT-5.2 by default", () => {
    // #when checking the model
    // #then it should be GPT-5.2
    expect(agent.model).toBe("openai/gpt-5.2")
  })

  test("should have low temperature for consistent reasoning", () => {
    // #when checking temperature
    // #then it should be 0.1
    expect(agent.temperature).toBe(0.1)
  })

  test("should be configured as subagent mode", () => {
    // #when checking mode
    // #then it should be subagent
    expect(agent.mode).toBe("subagent")
  })

  test("should have GPT-specific settings for GPT models", () => {
    // #given a GPT model
    const gptAgent = createSherlockAgent("openai/gpt-5.2")
    // #then it should have reasoningEffort and textVerbosity
    expect((gptAgent as Record<string, unknown>).reasoningEffort).toBe("medium")
    expect((gptAgent as Record<string, unknown>).textVerbosity).toBe("high")
  })

  test("should have thinking enabled for non-GPT models", () => {
    // #given a Claude model
    const claudeAgent = createSherlockAgent("anthropic/claude-sonnet-4-5")
    // #then it should have thinking enabled
    expect((claudeAgent as Record<string, unknown>).thinking).toEqual({
      type: "enabled",
      budgetTokens: 32000,
    })
  })

  test("should have specialist category metadata", () => {
    // #when checking metadata
    // #then category should be specialist
    expect(SHERLOCK_PROMPT_METADATA.category).toBe("specialist")
    expect(SHERLOCK_PROMPT_METADATA.cost).toBe("EXPENSIVE")
  })

  test("should have correct triggers", () => {
    // #when checking triggers
    // #then should include bug investigation triggers
    const domains = SHERLOCK_PROMPT_METADATA.triggers.map((t) => t.domain)
    expect(domains).toContain("Bug investigation")
    expect(domains).toContain("Hard debugging")
    expect(domains).toContain("State issues")
  })

  test("should have useWhen hints", () => {
    // #when checking useWhen
    // #then should include debugging scenarios
    expect(SHERLOCK_PROMPT_METADATA.useWhen).toContain(
      "Bug requires runtime evidence to diagnose"
    )
    expect(SHERLOCK_PROMPT_METADATA.useWhen).toContain(
      "Multiple possible root causes"
    )
  })

  test("should have avoidWhen hints", () => {
    // #when checking avoidWhen
    // #then should include simple cases
    expect(SHERLOCK_PROMPT_METADATA.avoidWhen).toContain(
      "Simple typos or syntax errors (use linter)"
    )
    expect(SHERLOCK_PROMPT_METADATA.avoidWhen).toContain(
      "Type errors visible from static analysis (use LSP)"
    )
  })

  test("should allow custom model override", () => {
    // #given a custom model
    const customAgent = createSherlockAgent("anthropic/claude-opus-4-5")
    // #then the model should be overridden
    expect(customAgent.model).toBe("anthropic/claude-opus-4-5")
  })

  test("should have a description", () => {
    // #when checking description
    // #then it should describe the debugging specialization
    expect(agent.description).toContain("Hypothesis-driven debugging")
    expect(agent.description).toContain("runtime evidence")
  })

  test("should have a comprehensive system prompt", () => {
    // #when checking the prompt
    // #then it should contain key sections
    expect(agent.prompt).toContain("You are Sherlock")
    expect(agent.prompt).toContain("Core Principles")
    expect(agent.prompt).toContain("8 Phases")
    expect(agent.prompt).toContain("Instrumentation Templates")
    expect(agent.prompt).toContain("Log Analysis")
    expect(agent.prompt).toContain("Security Rules")
  })

  test("should include hypothesis workflow in prompt", () => {
    // #when checking the prompt
    // #then it should describe the hypothesis workflow
    expect(agent.prompt).toContain("Hypothesis A")
    expect(agent.prompt).toContain("CONFIRMED")
    expect(agent.prompt).toContain("REJECTED")
    expect(agent.prompt).toContain("INCONCLUSIVE")
  })

  test("should include instrumentation patterns in prompt", () => {
    // #when checking the prompt
    // #then it should include code instrumentation templates
    expect(agent.prompt).toContain("#region agent log")
    expect(agent.prompt).toContain("hypothesisId")
    expect(agent.prompt).toContain("127.0.0.1:7242")
  })

  test("should have promptAlias in metadata", () => {
    // #when checking promptAlias
    // #then it should be Sherlock
    expect(SHERLOCK_PROMPT_METADATA.promptAlias).toBe("Sherlock")
  })
})
