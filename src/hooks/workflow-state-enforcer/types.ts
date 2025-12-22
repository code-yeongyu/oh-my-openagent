/**
 * Configuration for the workflow state enforcer hook.
 * Controls workflow command delegation and prerequisite validation.
 */
export interface WorkflowStateEnforcerConfig {
  enabled: boolean
  mode: "warn" | "block" | "disabled"
  workflow_agents: Record<string, string>
  prerequisites: Record<string, string[]>
}

export const DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG: WorkflowStateEnforcerConfig = {
  enabled: true,
  mode: "warn",
  workflow_agents: {
    "/specify": "product-strategist",
    "/plan": "strategic-planner",
    "/tasks": "task-planner",
    "/implement": "implementation-specialist",
    "/review": "oracle",
    "/test": "test-specialist",
  },
  prerequisites: {
    "/plan": ["spec.md"],
    "/tasks": ["plan.md"],
    "/implement": ["tasks.md"],
    "/review": ["spec.md"],
    "/test": ["spec.md"],
  },
}

export interface WorkflowValidationResult {
  valid: boolean
  command?: string
  expectedAgent?: string
  missingPrerequisites?: string[]
  suggestion?: string
}
