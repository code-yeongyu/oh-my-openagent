/**
 * Tests for context-learner agent (LIF-73)
 * Updated for OpenCode 1.1.1 permission system compatibility
 */

import { describe, test, expect } from "bun:test"
import { contextLearnerAgent } from "../../src/agents/context-learner"
import { builtinAgents, AGENT_ROLE_REGISTRY } from "../../src/agents"
import type { AgentConfig } from "@opencode-ai/sdk"

// Helper to check if agent has tool restrictions (either tools or permission format)
function hasToolRestrictions(agent: AgentConfig): boolean {
  return (
    (agent.tools !== undefined && typeof agent.tools === "object") ||
    (agent.permission !== undefined && typeof agent.permission === "object")
  )
}

// Helper to check if a tool is denied (works with both formats)
function isToolDenied(agent: AgentConfig, toolName: string): boolean {
  if (agent.permission && typeof agent.permission === "object") {
    const permission = agent.permission as Record<string, string>
    return permission[toolName] === "deny"
  }
  if (agent.tools && typeof agent.tools === "object") {
    const tools = agent.tools as Record<string, boolean>
    return tools[toolName] === false
  }
  return false
}

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

  // Check for tool restrictions (either tools or permission format)
  expect(hasToolRestrictions(agent)).toBe(true)
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
    test("should have edit permission denied", () => {
      expect(isToolDenied(contextLearnerAgent, "edit")).toBe(true)
    })

    test("should have bash permission denied", () => {
      expect(isToolDenied(contextLearnerAgent, "bash")).toBe(true)
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

    test("should mention quality rules (anti-bloat)", () => {
      expect(contextLearnerAgent.prompt).toContain("Quality Rules")
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
  test("specialist role should have tool restrictions", () => {
    expect(hasToolRestrictions(contextLearnerAgent)).toBe(true)
  })

  test("specialist role should deny edit and bash", () => {
    expect(isToolDenied(contextLearnerAgent, "edit")).toBe(true)
    expect(isToolDenied(contextLearnerAgent, "bash")).toBe(true)
  })
})
