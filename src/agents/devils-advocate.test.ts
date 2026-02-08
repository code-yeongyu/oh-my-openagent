import { describe, test, expect } from "bun:test"
import { createDevilsAdvocateAgent, devilsAdvocatePromptMetadata } from "./devils-advocate"

describe("createDevilsAdvocateAgent", () => {
  test("returns a subagent with denied write/edit/task/background_task/call_omo_agent permissions", () => {
    // given
    const model = "google/gemini-3-pro"

    // when
    const agent = createDevilsAdvocateAgent(model)

    // then
    expect(agent.mode).toBe("subagent")
    expect(agent.model).toBe(model)
    expect(agent.temperature).toBe(0.1)

    expect(agent.permission).toBeDefined()
    expect(agent.permission?.write).toBe("deny")
    expect(agent.permission?.edit).toBe("deny")
    expect(agent.permission?.task).toBe("deny")
    expect(agent.permission?.background_task).toBe("deny")
    expect(agent.permission?.call_omo_agent).toBe("deny")
  })

  test("uses reasoningEffort for GPT-family models", () => {
    // given
    const model = "openai/gpt-5.2"

    // when
    const agent = createDevilsAdvocateAgent(model)

    // then
    expect(agent.reasoningEffort).toBe("medium")
    expect(agent.thinking).toBeUndefined()
  })

  test("uses thinking for non-GPT models", () => {
    // given
    const model = "google/gemini-3-pro"

    // when
    const agent = createDevilsAdvocateAgent(model)

    // then
    expect(agent.thinking).toEqual({ type: "enabled", budgetTokens: 10000 })
    expect(agent.reasoningEffort).toBeUndefined()
  })
})

describe("devilsAdvocatePromptMetadata", () => {
  test("declares advisor category and CHEAP cost", () => {
    // given

    // when
    const metadata = devilsAdvocatePromptMetadata

    // then
    expect(metadata.category).toBe("advisor")
    expect(metadata.cost).toBe("CHEAP")
  })

  test("defines triggers and keyTrigger", () => {
    // given

    // when
    const metadata = devilsAdvocatePromptMetadata

    // then
    expect(metadata.triggers.length).toBeGreaterThan(0)
    expect(typeof metadata.keyTrigger).toBe("string")
    expect((metadata.keyTrigger ?? "").length).toBeGreaterThan(0)
  })
})
