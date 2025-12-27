/**
 * Tests for context-learner agent (LIF-73)
 */

import { describe, test, expect } from "bun:test"
import { contextLearnerAgent } from "../../src/agents/context-learner"
import { builtinAgents, AGENT_ROLE_REGISTRY } from "../../src/agents"
import type { AgentConfig } from "@opencode-ai/sdk"

function validateAgentConfig(agent: AgentConfig, _name: string) {
  expect(agent.description).toBeDefined()
  expect(typeof agent.description).toBe("string")
  expect(agent.description!.length).toBeGreaterThan(10)

  expect(agent.mode).toBe("subagent")
  expect(agent.model).toBeDefined()
  expect(typeof agent.model).toBe("string")

  expect(agent.prompt).toBeDefined()
  expect(typeof agent.prompt).toBe("string")
  expect(agent.prompt!.length).toBeGreaterThan(100)

  expect(agent.tools).toBeDefined()
  expect(typeof agent.tools).toBe("object")
}

describe("Context Learner Agent", () => {
  describe("agent configuration", () => {
    test("should have valid configuration", () => {
      validateAgentConfig(contextLearnerAgent, "context-learner")
    })

    test("should use Claude Opus model", () => {
      expect(contextLearnerAgent.model).toContain("claude-opus")
    })

    test("should be in subagent mode", () => {
      expect(contextLearnerAgent.mode).toBe("subagent")
    })

    test("should have low temperature for consistency", () => {
      expect(contextLearnerAgent.temperature).toBe(0.1)
    })
  })

  describe("tool permissions", () => {
    test("should have write permission enabled", () => {
      const tools = contextLearnerAgent.tools as Record<string, boolean>
      expect(tools.write).toBe(true)
    })

    test("should have edit permission disabled", () => {
      const tools = contextLearnerAgent.tools as Record<string, boolean>
      expect(tools.edit).toBe(false)
    })

    test("should have bash permission disabled", () => {
      const tools = contextLearnerAgent.tools as Record<string, boolean>
      expect(tools.bash).toBe(false)
    })

    test("should have background_task permission enabled", () => {
      const tools = contextLearnerAgent.tools as Record<string, boolean>
      expect(tools.background_task).toBe(true)
    })
  })

  describe("prompt content", () => {
    test("should mention meta-learning extraction", () => {
      expect(contextLearnerAgent.prompt).toContain("meta-learning")
    })

    test("should mention OmO orchestration improvement", () => {
      expect(contextLearnerAgent.prompt).toContain("OmO")
    })

    test("should mention agent_instructions category", () => {
      expect(contextLearnerAgent.prompt).toContain("agent_instructions")
    })

    test("should mention commands category", () => {
      expect(contextLearnerAgent.prompt).toContain("commands")
    })

    test("should mention orchestration category", () => {
      expect(contextLearnerAgent.prompt).toContain("orchestration")
    })

    test("should mention context_handling category", () => {
      expect(contextLearnerAgent.prompt).toContain("context_handling")
    })

    test("should mention tool_usage category", () => {
      expect(contextLearnerAgent.prompt).toContain("tool_usage")
    })

    test("should mention output path for learnings", () => {
      expect(contextLearnerAgent.prompt).toContain("context/learnings")
    })

    test("should mention confidence scoring", () => {
      expect(contextLearnerAgent.prompt).toContain("Confidence")
    })

    test("should mention anti-bloat rules", () => {
      expect(contextLearnerAgent.prompt).toContain("Anti-Bloat")
    })

    test("should mention maximum candidates per session", () => {
      expect(contextLearnerAgent.prompt).toContain("3")
    })
  })

  describe("description", () => {
    test("should describe meta-learning purpose", () => {
      expect(contextLearnerAgent.description).toContain("meta-learning")
    })

    test("should mention session analysis", () => {
      expect(contextLearnerAgent.description).toContain("session")
    })
  })
})

describe("Agent Registry Integration", () => {
  test("context-learner should be in builtinAgents", () => {
    expect(builtinAgents["context-learner"]).toBeDefined()
  })

  test("context-learner should be the same as contextLearnerAgent", () => {
    expect(builtinAgents["context-learner"]).toBe(contextLearnerAgent)
  })

  test("context-learner should have specialist role", () => {
    expect(AGENT_ROLE_REGISTRY["context-learner"]).toBe("specialist")
  })
})

describe("Agent Role Consistency", () => {
  test("specialist role should allow file writing", () => {
    const tools = contextLearnerAgent.tools as Record<string, boolean>
    expect(tools.write).toBe(true)
  })

  test("specialist role should not allow delegation", () => {
    const tools = contextLearnerAgent.tools as Record<string, boolean>
    expect(tools.task).toBeUndefined()
    expect(tools.call_omo_agent).toBeUndefined()
  })
})
