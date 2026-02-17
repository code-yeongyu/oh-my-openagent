import { describe, test, expect } from "bun:test"
import {
  createSubPrometheusAgent,
  SUB_PROMETHEUS_SYSTEM_PROMPT,
} from "./sub-prometheus"

describe("createSubPrometheusAgent", () => {
  //#given a model string
  //#when creating a sub-prometheus agent
  //#then mode should be "subagent" (hidden, not user-selectable)
  test("returns mode 'subagent'", () => {
    const config = createSubPrometheusAgent("anthropic/claude-sonnet-4-5")
    expect(config.mode).toBe("subagent")
  })

  //#given a model string
  //#when creating a sub-prometheus agent
  //#then temperature should be 0.1
  test("uses temperature 0.1", () => {
    const config = createSubPrometheusAgent("anthropic/claude-sonnet-4-5")
    expect(config.temperature).toBe(0.1)
  })

  //#given a model string
  //#when creating a sub-prometheus agent
  //#then thinking should be enabled with 32k budget
  test("enables thinking with 32k budget tokens", () => {
    const config = createSubPrometheusAgent("anthropic/claude-sonnet-4-5")
    expect(config.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
  })

  //#given a model string
  //#when creating a sub-prometheus agent
  //#then tool restrictions should deny "write" and "edit"
  test("denies write and edit tools", () => {
    const config = createSubPrometheusAgent("anthropic/claude-sonnet-4-5")
    const permission = (config as Record<string, unknown>).permission as Record<string, string>
    expect(permission.write).toBe("deny")
    expect(permission.edit).toBe("deny")
  })

  //#given a model string
  //#when creating a sub-prometheus agent
  //#then it should use the provided model
  test("uses provided model", () => {
    const config = createSubPrometheusAgent("anthropic/claude-sonnet-4-5")
    expect(config.model).toBe("anthropic/claude-sonnet-4-5")
  })

  //#given the factory function
  //#when checking its static mode
  //#then it should be "subagent"
  test("has static mode property set to 'subagent'", () => {
    expect(createSubPrometheusAgent.mode).toBe("subagent")
  })

  //#given a description
  //#when creating a sub-prometheus agent
  //#then description should exist
  test("has a description", () => {
    const config = createSubPrometheusAgent("anthropic/claude-sonnet-4-5")
    expect(config.description).toBeTruthy()
    expect(typeof config.description).toBe("string")
  })
})

describe("SUB_PROMETHEUS_SYSTEM_PROMPT", () => {
  //#given the system prompt
  //#when checking for domain planning focus
  //#then it should reference domain-specific planning
  test("contains 'domain' for domain-specific planning", () => {
    expect(SUB_PROMETHEUS_SYSTEM_PROMPT.toLowerCase()).toContain("domain")
  })

  //#given the system prompt
  //#when checking for constraints acknowledgment
  //#then it should reference constraints
  test("contains 'constraints' for global constraints acknowledgment", () => {
    expect(SUB_PROMETHEUS_SYSTEM_PROMPT.toLowerCase()).toContain("constraints")
  })

  //#given the system prompt
  //#when checking for structured output
  //#then it should reference the SubPlanSchema structure
  test("references SubPlanSchema output structure", () => {
    const prompt = SUB_PROMETHEUS_SYSTEM_PROMPT
    // Must reference key SubPlanSchema fields
    expect(prompt).toContain("domain")
    expect(prompt).toContain("domain_description")
    expect(prompt).toContain("tasks")
    expect(prompt).toContain("wave_assignments")
    expect(prompt).toContain("constraints_acknowledged")
    expect(prompt).toContain("source_sub_planner")
  })

  //#given the system prompt
  //#when checking for depth-1 enforcement
  //#then it should forbid further decomposition
  test("enforces depth-1 (no further decomposition)", () => {
    const prompt = SUB_PROMETHEUS_SYSTEM_PROMPT.toLowerCase()
    // Must contain instruction against further decomposition
    const hasDepthEnforcement =
      prompt.includes("do not decompose further") ||
      prompt.includes("do not spawn") ||
      prompt.includes("no further decomposition") ||
      prompt.includes("depth 1") ||
      prompt.includes("no recursive")
    expect(hasDepthEnforcement).toBe(true)
  })

  //#given the system prompt
  //#when checking for structured output instruction
  //#then it should instruct JSON output
  test("instructs structured JSON output", () => {
    const prompt = SUB_PROMETHEUS_SYSTEM_PROMPT.toLowerCase()
    const hasStructuredOutput =
      prompt.includes("json") || prompt.includes("structured output")
    expect(hasStructuredOutput).toBe(true)
  })

  //#given the system prompt
  //#when checking for task schema fields
  //#then it should reference acceptance_criteria and depends_on
  test("references task schema fields", () => {
    const prompt = SUB_PROMETHEUS_SYSTEM_PROMPT
    expect(prompt).toContain("acceptance_criteria")
    expect(prompt).toContain("depends_on")
  })

  //#given the system prompt
  //#when checking for read-only constraint
  //#then it should mention read-only behavior
  test("mentions read-only constraint", () => {
    const prompt = SUB_PROMETHEUS_SYSTEM_PROMPT.toLowerCase()
    const hasReadOnly =
      prompt.includes("read-only") || prompt.includes("read only")
    expect(hasReadOnly).toBe(true)
  })
})
