import { describe, expect, test } from "bun:test"
import { createArgusAgent, ARGUS_PROMPT_METADATA, ARGUS_SYSTEM_PROMPT } from "./argus"

describe("createArgusAgent", () => {
  test("creates agent with subagent mode and temperature 0.1", () => {
    // given
    const model = "openai/gpt-6-astra"

    // when
    const agent = createArgusAgent(model)

    // then
    expect(agent.mode).toBe("subagent")
    expect(createArgusAgent.mode).toBe("subagent")
    expect(agent.model).toBe(model)
    expect(agent.temperature).toBe(0.1)
  })

  test("enforces read-only tool restrictions denying write, edit, apply_patch, and delegation", () => {
    // given
    const agent = createArgusAgent("anthropic/claude-opus-5-5")

    // then
    expect(agent.permission?.write).toBe("deny")
    expect(agent.permission?.edit).toBe("deny")
    expect(agent.permission?.apply_patch).toBe("deny")
    expect(agent.permission?.task).toBe("deny")
    expect(agent.permission?.call_omo_agent).toBe("deny")
  })

  test("prompt contains core security directives, CWE, and taint flow instructions", () => {
    // given
    const agent = createArgusAgent("openai/gpt-5.6-sol")

    // then
    expect(agent.prompt).toBe(ARGUS_SYSTEM_PROMPT)
    expect(agent.prompt).toContain("Argus")
    expect(agent.prompt).toContain("Evidence-Based Security")
    expect(agent.prompt).toContain("CWE-89")
    expect(agent.prompt).toContain("IDOR")
    expect(agent.prompt).toContain("Remediation Diff")
  })

  test("metadata exposes advisor category and security audit triggers", () => {
    // then
    expect(ARGUS_PROMPT_METADATA.category).toBe("advisor")
    expect(ARGUS_PROMPT_METADATA.cost).toBe("EXPENSIVE")
    expect(ARGUS_PROMPT_METADATA.promptAlias).toBe("Argus")
    expect(ARGUS_PROMPT_METADATA.triggers.length).toBeGreaterThan(0)
    expect(ARGUS_PROMPT_METADATA.useWhen?.length).toBeGreaterThan(0)
  })
})
