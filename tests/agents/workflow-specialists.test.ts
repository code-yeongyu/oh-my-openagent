/**
 * Tests for workflow specialist agents (LIF-72)
 *
 * These tests verify that agent configurations are valid and follow the expected patterns.
 */

import { describe, test, expect } from "bun:test"
import { productStrategistAgent } from "../../src/agents/product-strategist"
import { strategicPlannerAgent } from "../../src/agents/strategic-planner"
import { taskPlannerAgent } from "../../src/agents/task-planner"
import { builtinAgents, AGENT_ROLE_REGISTRY } from "../../src/agents"
import type { AgentConfig } from "@opencode-ai/sdk"

// Helper to validate agent config structure
function validateAgentConfig(agent: AgentConfig, name: string) {
  expect(agent.description).toBeDefined()
  expect(typeof agent.description).toBe("string")
  expect(agent.description.length).toBeGreaterThan(10)

  expect(agent.mode).toBe("subagent")
  expect(agent.model).toBeDefined()
  expect(typeof agent.model).toBe("string")

  expect(agent.prompt).toBeDefined()
  expect(typeof agent.prompt).toBe("string")
  expect(agent.prompt.length).toBeGreaterThan(100)

  expect(agent.tools).toBeDefined()
  expect(typeof agent.tools).toBe("object")
}

describe("Workflow Specialist Agents", () => {
  describe("product-strategist", () => {
    test("should have valid configuration", () => {
      validateAgentConfig(productStrategistAgent, "product-strategist")
    })

    test("should use Claude Sonnet model", () => {
      expect(productStrategistAgent.model).toContain("claude-sonnet")
    })

    test("should have required tools for spec writing", () => {
      const tools = productStrategistAgent.tools as Record<string, boolean>
      expect(tools.write).toBe(true)
      expect(tools.edit).toBe(true)
      expect(tools.read).toBe(true)
      expect(tools.create_spec_folder).toBe(true)
      expect(tools.update_workflow_state).toBe(true)
    })

    test("should have Linear tools for issue management", () => {
      const tools = productStrategistAgent.tools as Record<string, boolean>
      expect(tools.linear_branch).toBe(true)
      expect(tools.linear_update_status).toBe(true)
      expect(tools.linear_create_issue).toBe(true)
    })

    test("prompt should mention research capability", () => {
      expect(productStrategistAgent.prompt).toContain("background_task")
      expect(productStrategistAgent.prompt).toContain("explore")
      expect(productStrategistAgent.prompt).toContain("librarian")
    })

    test("prompt should mention update_workflow_state", () => {
      expect(productStrategistAgent.prompt).toContain("update_workflow_state")
    })

    test("prompt should emphasize technology-agnostic specs", () => {
      expect(productStrategistAgent.prompt).toContain("technology-agnostic")
    })
  })

  describe("strategic-planner", () => {
    test("should have valid configuration", () => {
      validateAgentConfig(strategicPlannerAgent, "strategic-planner")
    })

    test("should use Claude Sonnet model", () => {
      expect(strategicPlannerAgent.model).toContain("claude-sonnet")
    })

    test("should have required tools for planning", () => {
      const tools = strategicPlannerAgent.tools as Record<string, boolean>
      expect(tools.write).toBe(true)
      expect(tools.edit).toBe(true)
      expect(tools.read).toBe(true)
      expect(tools.update_workflow_state).toBe(true)
    })

    test("prompt should mention oracle consultation", () => {
      expect(strategicPlannerAgent.prompt).toContain("oracle")
    })

    test("prompt should mention research capability", () => {
      expect(strategicPlannerAgent.prompt).toContain("background_task")
    })
  })

  describe("task-planner", () => {
    test("should have valid configuration", () => {
      validateAgentConfig(taskPlannerAgent, "task-planner")
    })

    test("should use Claude Sonnet model", () => {
      expect(taskPlannerAgent.model).toContain("claude-sonnet")
    })

    test("should have Linear tools for task creation", () => {
      const tools = taskPlannerAgent.tools as Record<string, boolean>
      expect(tools.linear_create_issue).toBe(true)
      expect(tools.linear_update_status).toBe(true)
    })

    test("prompt should mention phased breakdown", () => {
      expect(taskPlannerAgent.prompt).toContain("Phase")
    })

    test("prompt should mention granularity requirements", () => {
      const prompt = taskPlannerAgent.prompt.toLowerCase()
      expect(prompt).toContain("< 2h")
    })
  })
})

describe("Agent Registry Integration", () => {
  test("all workflow specialists should be in builtinAgents", () => {
    expect(builtinAgents["product-strategist"]).toBeDefined()
    expect(builtinAgents["strategic-planner"]).toBeDefined()
    expect(builtinAgents["task-planner"]).toBeDefined()
  })

  test("all workflow specialists should have specialist role", () => {
    expect(AGENT_ROLE_REGISTRY["product-strategist"]).toBe("specialist")
    expect(AGENT_ROLE_REGISTRY["strategic-planner"]).toBe("specialist")
    expect(AGENT_ROLE_REGISTRY["task-planner"]).toBe("specialist")
  })

  test("agent registry should have correct hierarchy", () => {
    // Team lead
    expect(AGENT_ROLE_REGISTRY["OmO"]).toBe("team-lead")

    // Manager
    expect(AGENT_ROLE_REGISTRY["implementation-specialist"]).toBe("manager")

    // Advisor
    expect(AGENT_ROLE_REGISTRY["oracle"]).toBe("advisor")

    // Utility
    expect(AGENT_ROLE_REGISTRY["explore"]).toBe("utility")
    expect(AGENT_ROLE_REGISTRY["librarian"]).toBe("utility")
  })
})

describe("Agent Tool Restrictions", () => {
  test("specialists should not have task/call_omo_agent in tools", () => {
    const checkNoDelegate = (agent: AgentConfig) => {
      const tools = agent.tools as Record<string, boolean> | undefined
      if (tools) {
        // Specialists shouldn't explicitly enable task delegation
        // The tool config system handles this at runtime
        expect(tools.task).not.toBe(true)
        expect(tools.call_omo_agent).not.toBe(true)
      }
    }

    checkNoDelegate(productStrategistAgent)
    checkNoDelegate(strategicPlannerAgent)
    checkNoDelegate(taskPlannerAgent)
  })

  test("workflow specialists should have background_task capability", () => {
    // This is enforced at the tool-config level, not agent config
    // Background task should be available for research
    const prompt1 = productStrategistAgent.prompt
    const prompt2 = strategicPlannerAgent.prompt
    const prompt3 = taskPlannerAgent.prompt

    expect(prompt1).toContain("background_task")
    expect(prompt2).toContain("background_task")
    expect(prompt3).toContain("background_task")
  })
})
