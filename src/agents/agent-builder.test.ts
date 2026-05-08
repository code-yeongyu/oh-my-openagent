import { describe, test, expect } from "bun:test"
import { buildAgent } from "./agent-builder"
import type { AgentFactory } from "./types"

describe("#given an agent factory with mode", () => {
  const mockFactory = ((model: string) => ({
    name: "test-agent",
    description: "Test",
    instructions: "test",
    model,
    temperature: 0.1,
  })) as AgentFactory
  mockFactory.mode = "subagent"

  test("#when building agent from factory", () => {
    const agent = buildAgent(mockFactory, "test-model")
    expect(agent.mode).toBe("subagent")
  })
})

describe("#given an agent factory with mode=primary", () => {
  const mockFactory = ((model: string) => ({
    name: "primary-agent",
    description: "Primary Test",
    instructions: "test",
    model,
    temperature: 0.1,
  })) as AgentFactory
  mockFactory.mode = "primary"

  test("#when building agent from factory", () => {
    const agent = buildAgent(mockFactory, "test-model")
    expect(agent.mode).toBe("primary")
  })
})

describe("#given an agent config object without mode", () => {
  const mockConfig = {
    name: "config-agent",
    description: "Config Test",
    instructions: "test",
    model: "test-model",
    temperature: 0.1,
  }

  test("#when building agent from config object", () => {
    const agent = buildAgent(mockConfig, "test-model")
    expect(agent.mode).toBeUndefined()
  })
})

describe("#given an agent factory with mode but config already has mode", () => {
  const mockFactory = ((model: string) => ({
    name: "override-agent",
    description: "Override Test",
    instructions: "test",
    model,
    temperature: 0.1,
    mode: "all",
  })) as AgentFactory
  mockFactory.mode = "subagent"

  test("#when building agent from factory", () => {
    const agent = buildAgent(mockFactory, "test-model")
    expect(agent.mode).toBe("all")
  })
})
