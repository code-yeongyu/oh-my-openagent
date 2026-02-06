import { describe, test, expect } from "bun:test"
import {
  createDevilsAdvocateAgent,
  DEVILS_ADVOCATE_PROMPT_METADATA,
} from "./devils-advocate"

describe("createDevilsAdvocateAgent", () => {
  test("returns agent with default model google/gemini-3-pro-preview", () => {
    // #given - no model argument

    // #when
    const agent = createDevilsAdvocateAgent()

    // #then
    expect(agent.model).toBe("google/gemini-3-pro-preview")
  })

  test("returns agent with custom model when provided", () => {
    // #given
    const customModel = "openai/gpt-5.2"

    // #when
    const agent = createDevilsAdvocateAgent(customModel)

    // #then
    expect(agent.model).toBe(customModel)
  })

  test("has mode subagent", () => {
    // #given - default agent

    // #when
    const agent = createDevilsAdvocateAgent()

    // #then
    expect(agent.mode).toBe("subagent")
  })

  test("has temperature 0.1", () => {
    // #given - default agent

    // #when
    const agent = createDevilsAdvocateAgent()

    // #then
    expect(agent.temperature).toBe(0.1)
  })

  test("tool restrictions block write, edit, task, background_task", () => {
    // #given - default agent

    // #when
    const agent = createDevilsAdvocateAgent()

    // #then - check that write/edit/task/background_task are restricted
    // Works with both legacy (tools) and new (permission) format
    if ("tools" in agent) {
      const tools = agent.tools as Record<string, boolean>
      expect(tools.write).toBe(false)
      expect(tools.edit).toBe(false)
      expect(tools.task).toBe(false)
      expect(tools.background_task).toBe(false)
    } else if ("permission" in agent) {
      const permission = agent.permission as Record<string, string>
      expect(permission.write).toBe("deny")
      expect(permission.edit).toBe("deny")
      expect(permission.task).toBe("deny")
      expect(permission.background_task).toBe("deny")
    }
  })
})

describe("DEVILS_ADVOCATE_PROMPT_METADATA", () => {
  test("has category advisor", () => {
    // #given - exported metadata

    // #when - access category

    // #then
    expect(DEVILS_ADVOCATE_PROMPT_METADATA.category).toBe("advisor")
  })

  test("has cost CHEAP", () => {
    // #given - exported metadata

    // #when - access cost

    // #then
    expect(DEVILS_ADVOCATE_PROMPT_METADATA.cost).toBe("CHEAP")
  })

  test("has triggers defined as non-empty array", () => {
    // #given - exported metadata

    // #when - access triggers

    // #then
    expect(Array.isArray(DEVILS_ADVOCATE_PROMPT_METADATA.triggers)).toBe(true)
    expect(DEVILS_ADVOCATE_PROMPT_METADATA.triggers.length).toBeGreaterThan(0)
  })
})

describe("createDevilsAdvocateAgent model-specific config", () => {
  test("with GPT model returns reasoningEffort config", () => {
    // #given
    const gptModel = "openai/gpt-5.2"

    // #when
    const agent = createDevilsAdvocateAgent(gptModel)

    // #then
    expect(agent.reasoningEffort).toBe("medium")
    expect(agent.thinking).toBeUndefined()
  })

  test("with non-GPT model returns thinking config", () => {
    // #given
    const nonGptModel = "google/gemini-3-pro-preview"

    // #when
    const agent = createDevilsAdvocateAgent(nonGptModel)

    // #then
    expect(agent.thinking).toEqual({ type: "enabled", budgetTokens: 10000 })
    expect(agent.reasoningEffort).toBeUndefined()
  })
})
