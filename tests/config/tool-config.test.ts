/**
 * Tests for tool configuration and role-based restrictions (LIF-72)
 *
 * These tests verify that tool restrictions are correctly applied by role.
 */

import { describe, test, expect } from "bun:test"
import { getRoleDefaultTools, isToolAllowedForRole, type AgentRole } from "../../src/config/tool-config"
import { AGENT_ROLE_REGISTRY } from "../../src/agents"

describe("Tool Config Role Defaults", () => {
  describe("team-lead role", () => {
    test("should have access to all delegation tools", () => {
      const defaults = getRoleDefaultTools("team-lead")
      expect(defaults.task).toBe(true)
      expect(defaults.background_task).toBe(true)
      expect(defaults.call_omo_agent).toBe(true)
    })

    test("should have access to file modification tools", () => {
      const defaults = getRoleDefaultTools("team-lead")
      expect(defaults.write).toBe(true)
      expect(defaults.edit).toBe(true)
    })
  })

  describe("manager role", () => {
    test("should have task/background_task but NOT call_omo_agent (prevents loops)", () => {
      const defaults = getRoleDefaultTools("manager")
      expect(defaults.task).toBe(true)
      expect(defaults.background_task).toBe(true)
      expect(defaults.call_omo_agent).toBe(false)
    })

    test("should have access to file modification tools", () => {
      const defaults = getRoleDefaultTools("manager")
      expect(defaults.write).toBe(true)
      expect(defaults.edit).toBe(true)
    })
  })

  describe("specialist role", () => {
    test("should NOT have access to delegation tools", () => {
      const defaults = getRoleDefaultTools("specialist")
      expect(defaults.task).toBe(false)
      expect(defaults.call_omo_agent).toBe(false)
    })

    test("should have access to background_task for research", () => {
      const defaults = getRoleDefaultTools("specialist")
      expect(defaults.background_task).toBe(true)
    })

    test("should have access to file modification tools", () => {
      const defaults = getRoleDefaultTools("specialist")
      expect(defaults.write).toBe(true)
      expect(defaults.edit).toBe(true)
    })
  })

  describe("advisor role", () => {
    test("should NOT have access to file modification tools", () => {
      const defaults = getRoleDefaultTools("advisor")
      expect(defaults.write).toBe(false)
      expect(defaults.edit).toBe(false)
    })

    test("should NOT have access to delegation tools", () => {
      const defaults = getRoleDefaultTools("advisor")
      expect(defaults.task).toBe(false)
      expect(defaults.background_task).toBe(false)
      expect(defaults.call_omo_agent).toBe(false)
    })

    test("should have access to read_context", () => {
      const defaults = getRoleDefaultTools("advisor")
      expect(defaults.read_context).toBe(true)
    })
  })

  describe("utility role", () => {
    test("should NOT have access to file modification tools", () => {
      const defaults = getRoleDefaultTools("utility")
      expect(defaults.write).toBe(false)
      expect(defaults.edit).toBe(false)
    })

    test("should NOT have access to delegation tools", () => {
      const defaults = getRoleDefaultTools("utility")
      expect(defaults.task).toBe(false)
      expect(defaults.background_task).toBe(false)
      expect(defaults.call_omo_agent).toBe(false)
    })

    test("should have access to read_context", () => {
      const defaults = getRoleDefaultTools("utility")
      expect(defaults.read_context).toBe(true)
    })
  })
})

describe("isToolAllowedForRole", () => {
  describe("delegation tools", () => {
    test("team-lead should be allowed to use task", () => {
      expect(isToolAllowedForRole("task", "team-lead")).toBe(true)
    })

    test("manager should be allowed to use task", () => {
      expect(isToolAllowedForRole("task", "manager")).toBe(true)
    })

    test("specialist should NOT be allowed to use task", () => {
      expect(isToolAllowedForRole("task", "specialist")).toBe(false)
    })

    test("advisor should NOT be allowed to use task", () => {
      expect(isToolAllowedForRole("task", "advisor")).toBe(false)
    })

    test("utility should NOT be allowed to use task", () => {
      expect(isToolAllowedForRole("task", "utility")).toBe(false)
    })
  })

  describe("file modification tools", () => {
    test("specialist should be allowed to use write", () => {
      expect(isToolAllowedForRole("write", "specialist")).toBe(true)
    })

    test("advisor should NOT be allowed to use write", () => {
      expect(isToolAllowedForRole("write", "advisor")).toBe(false)
    })

    test("utility should NOT be allowed to use write", () => {
      expect(isToolAllowedForRole("write", "utility")).toBe(false)
    })
  })

  describe("background_task for research", () => {
    test("specialist should be allowed to use background_task", () => {
      expect(isToolAllowedForRole("background_task", "specialist")).toBe(true)
    })

    test("advisor should NOT be allowed to use background_task", () => {
      expect(isToolAllowedForRole("background_task", "advisor")).toBe(false)
    })
  })
})

describe("Agent Role Registry Consistency", () => {
  test("all agents in registry should have valid roles", () => {
    const validRoles: AgentRole[] = ["team-lead", "manager", "specialist", "advisor", "utility"]

    for (const [agentName, role] of Object.entries(AGENT_ROLE_REGISTRY)) {
      expect(validRoles).toContain(role)
    }
  })

  test("workflow specialists should all be specialists", () => {
    const workflowSpecialists = [
      "product-strategist",
      "strategic-planner",
      "task-planner",
    ]

    for (const agent of workflowSpecialists) {
      expect(AGENT_ROLE_REGISTRY[agent]).toBe("specialist")
    }
  })

  test("implementation-specialist should be manager (can delegate)", () => {
    expect(AGENT_ROLE_REGISTRY["implementation-specialist"]).toBe("manager")
  })

  test("oracle should be advisor (read-only)", () => {
    expect(AGENT_ROLE_REGISTRY["oracle"]).toBe("advisor")
  })

  test("explore and librarian should be utility (read-only)", () => {
    expect(AGENT_ROLE_REGISTRY["explore"]).toBe("utility")
    expect(AGENT_ROLE_REGISTRY["librarian"]).toBe("utility")
  })
})

describe("Role Hierarchy", () => {
  test("higher roles should have more capabilities", () => {
    const teamLeadTools = getRoleDefaultTools("team-lead")
    const managerTools = getRoleDefaultTools("manager")
    const specialistTools = getRoleDefaultTools("specialist")

    // Team lead and manager can delegate
    expect(teamLeadTools.task).toBe(true)
    expect(managerTools.task).toBe(true)
    expect(specialistTools.task).toBe(false)

    // All file-modifying roles can write
    expect(teamLeadTools.write).toBe(true)
    expect(managerTools.write).toBe(true)
    expect(specialistTools.write).toBe(true)
  })

  test("read-only roles should not have write access", () => {
    const advisorTools = getRoleDefaultTools("advisor")
    const utilityTools = getRoleDefaultTools("utility")

    expect(advisorTools.write).toBe(false)
    expect(advisorTools.edit).toBe(false)
    expect(utilityTools.write).toBe(false)
    expect(utilityTools.edit).toBe(false)
  })
})
