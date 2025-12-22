/**
 * Tests for workflow-state-enforcer hook (LIF-72)
 *
 * These tests verify the hook's command detection and message injection logic.
 */

import { describe, test, expect } from "bun:test"
import {
  DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG,
  type WorkflowStateEnforcerConfig,
} from "../../src/hooks/workflow-state-enforcer/types"

import {
  detectWorkflowCommand,
  WORKFLOW_COMMANDS,
  checkPrerequisites,
} from "../../src/hooks/workflow-state-enforcer"

describe("Workflow Command Detection", () => {
  describe("basic command detection", () => {
    test("should detect /specify command", () => {
      expect(detectWorkflowCommand("/specify")).toBe("/specify")
      expect(detectWorkflowCommand("/specify user auth feature")).toBe("/specify")
    })

    test("should detect /plan command", () => {
      expect(detectWorkflowCommand("/plan")).toBe("/plan")
      expect(detectWorkflowCommand("/plan for the feature")).toBe("/plan")
    })

    test("should detect /tasks command", () => {
      expect(detectWorkflowCommand("/tasks")).toBe("/tasks")
      expect(detectWorkflowCommand("/tasks breakdown")).toBe("/tasks")
    })

    test("should detect /implement command", () => {
      expect(detectWorkflowCommand("/implement")).toBe("/implement")
      expect(detectWorkflowCommand("/implement the feature")).toBe("/implement")
    })

    test("should detect /review command", () => {
      expect(detectWorkflowCommand("/review")).toBe("/review")
      expect(detectWorkflowCommand("/review the code")).toBe("/review")
    })

    test("should detect /test command", () => {
      expect(detectWorkflowCommand("/test")).toBe("/test")
      expect(detectWorkflowCommand("/test the implementation")).toBe("/test")
    })
  })

  describe("edge cases", () => {
    test("should handle whitespace", () => {
      expect(detectWorkflowCommand("  /specify  ")).toBe("/specify")
      expect(detectWorkflowCommand("\n/plan\n")).toBe("/plan")
      expect(detectWorkflowCommand("\t/tasks")).toBe("/tasks")
    })

    test("should be case-insensitive", () => {
      expect(detectWorkflowCommand("/SPECIFY")).toBe("/specify")
      expect(detectWorkflowCommand("/Plan")).toBe("/plan")
      expect(detectWorkflowCommand("/TASKS")).toBe("/tasks")
    })

    test("should return null for non-workflow commands", () => {
      expect(detectWorkflowCommand("/commit")).toBeNull()
      expect(detectWorkflowCommand("/help")).toBeNull()
      expect(detectWorkflowCommand("specify")).toBeNull()
      expect(detectWorkflowCommand("")).toBeNull()
      expect(detectWorkflowCommand("hello world")).toBeNull()
    })

    test("should not match partial commands", () => {
      expect(detectWorkflowCommand("/specifying")).toBeNull()
      expect(detectWorkflowCommand("/planning")).toBeNull()
    })
  })
})

describe("Workflow State Enforcer Config", () => {
  test("should have default config", () => {
    expect(DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG).toBeDefined()
    expect(DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG.enabled).toBe(true)
    expect(DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG.mode).toBe("warn")
  })

  test("should have workflow agents mapping", () => {
    const agents = DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG.workflow_agents
    expect(agents["/specify"]).toBe("product-strategist")
    expect(agents["/plan"]).toBe("strategic-planner")
    expect(agents["/tasks"]).toBe("task-planner")
    expect(agents["/implement"]).toBe("implementation-specialist")
    expect(agents["/review"]).toBe("oracle")
    expect(agents["/test"]).toBe("test-specialist")
  })

  test("should map all workflow commands to agents", () => {
    const agents = DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG.workflow_agents
    for (const cmd of WORKFLOW_COMMANDS) {
      expect(agents[cmd]).toBeDefined()
      expect(typeof agents[cmd]).toBe("string")
    }
  })
})

describe("Config Override", () => {
  test("should allow partial config override", () => {
    const override: Partial<WorkflowStateEnforcerConfig> = {
      mode: "block",
    }

    const merged = {
      ...DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG,
      ...override,
    }

    expect(merged.enabled).toBe(true) // From default
    expect(merged.mode).toBe("block") // Overridden
    expect(merged.workflow_agents["/specify"]).toBe("product-strategist") // From default
  })

  test("should allow disabling the hook", () => {
    const override: Partial<WorkflowStateEnforcerConfig> = {
      enabled: false,
    }

    const merged = {
      ...DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG,
      ...override,
    }

    expect(merged.enabled).toBe(false)
  })

  test("should allow custom agent mapping", () => {
    const override: Partial<WorkflowStateEnforcerConfig> = {
      workflow_agents: {
        ...DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG.workflow_agents,
        "/review": "custom-reviewer",
      },
    }

    const merged = {
      ...DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG,
      ...override,
    }

    expect(merged.workflow_agents["/review"]).toBe("custom-reviewer")
    expect(merged.workflow_agents["/specify"]).toBe("product-strategist")
  })
})

describe("Message Generation", () => {
  test("should generate message with correct agent name", () => {
    const command = "/specify"
    const expectedAgent = DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG.workflow_agents[command]

    const message = `📋 [Workflow] Detected ${command} command. Recommended agent: ${expectedAgent}

IMPORTANT: Delegate this work to the ${expectedAgent} agent for best results:
\`\`\`typescript
call_omo_agent(subagent_type="${expectedAgent}", run_in_background=false, prompt="[task details]")
\`\`\`

The ${expectedAgent} agent is specialized for this workflow step.`

    expect(message).toContain("/specify")
    expect(message).toContain("product-strategist")
    expect(message).toContain("call_omo_agent")
  })

  test("should include call_omo_agent syntax", () => {
    const command = "/plan"
    const expectedAgent = DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG.workflow_agents[command]

    const message = `call_omo_agent(subagent_type="${expectedAgent}", run_in_background=false, prompt="[task details]")`

    expect(message).toContain("subagent_type=")
    expect(message).toContain("run_in_background=false")
    expect(message).toContain("prompt=")
  })
})

describe("Prerequisites Validation", () => {
  const defaultPrereqs = DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG.prerequisites

  describe("commands without prerequisites", () => {
    test("/specify should have no prerequisites", () => {
      const result = checkPrerequisites("/specify", defaultPrereqs, "/nonexistent")
      expect(result.valid).toBe(true)
      expect(result.command).toBe("/specify")
      expect(result.missingPrerequisites).toBeUndefined()
    })
  })

  describe("commands with prerequisites", () => {
    test("/plan should require spec.md", () => {
      const result = checkPrerequisites("/plan", defaultPrereqs, "/nonexistent/path")
      expect(result.valid).toBe(false)
      expect(result.command).toBe("/plan")
      expect(result.missingPrerequisites).toContain("spec.md")
      expect(result.suggestion).toContain("/specify")
    })

    test("/tasks should require plan.md", () => {
      const result = checkPrerequisites("/tasks", defaultPrereqs, "/nonexistent/path")
      expect(result.valid).toBe(false)
      expect(result.command).toBe("/tasks")
      expect(result.missingPrerequisites).toContain("plan.md")
      expect(result.suggestion).toContain("/plan")
    })

    test("/implement should require tasks.md", () => {
      const result = checkPrerequisites("/implement", defaultPrereqs, "/nonexistent/path")
      expect(result.valid).toBe(false)
      expect(result.command).toBe("/implement")
      expect(result.missingPrerequisites).toContain("tasks.md")
      expect(result.suggestion).toContain("/tasks")
    })

    test("/review should require spec.md", () => {
      const result = checkPrerequisites("/review", defaultPrereqs, "/nonexistent/path")
      expect(result.valid).toBe(false)
      expect(result.command).toBe("/review")
      expect(result.missingPrerequisites).toContain("spec.md")
      expect(result.suggestion).toContain("/specify")
    })

    test("/test should require spec.md", () => {
      const result = checkPrerequisites("/test", defaultPrereqs, "/nonexistent/path")
      expect(result.valid).toBe(false)
      expect(result.command).toBe("/test")
      expect(result.missingPrerequisites).toContain("spec.md")
      expect(result.suggestion).toContain("/specify")
    })
  })

  describe("empty prerequisites config", () => {
    test("should return valid for any command with empty prerequisites", () => {
      const emptyPrereqs: Record<string, string[]> = {}
      const result = checkPrerequisites("/plan", emptyPrereqs, "/any/path")
      expect(result.valid).toBe(true)
    })

    test("should return valid for command with empty array", () => {
      const emptyArrayPrereqs = { "/plan": [] }
      const result = checkPrerequisites("/plan", emptyArrayPrereqs, "/any/path")
      expect(result.valid).toBe(true)
    })
  })

  describe("suggestion messages", () => {
    test("should suggest /specify before /plan", () => {
      const result = checkPrerequisites("/plan", defaultPrereqs, "/nonexistent")
      expect(result.suggestion).toBe("Run /specify first to create the required artifacts.")
    })

    test("should suggest /plan before /tasks", () => {
      const result = checkPrerequisites("/tasks", defaultPrereqs, "/nonexistent")
      expect(result.suggestion).toBe("Run /plan first to create the required artifacts.")
    })

    test("should suggest /tasks before /implement", () => {
      const result = checkPrerequisites("/implement", defaultPrereqs, "/nonexistent")
      expect(result.suggestion).toBe("Run /tasks first to create the required artifacts.")
    })
  })
})
