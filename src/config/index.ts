export {
  OhMyOpenCodeConfigSchema,
  AgentOverrideConfigSchema,
  AgentOverridesSchema,
  McpNameSchema,
  AgentNameSchema,
  HookNameSchema,
  OmoAgentConfigSchema,
} from "./schema"

export type {
  OhMyOpenCodeConfig,
  AgentOverrideConfig,
  AgentOverrides,
  McpName,
  AgentName,
  HookName,
  OmoAgentConfig,
  GovernanceHookHealthConfig,
} from "./schema"

// Governance template exports (LIF-62)
export {
  GOVERNANCE_TEMPLATE_FULL,
  GOVERNANCE_TEMPLATE_MINIMAL,
  getGovernanceTemplate,
} from "./governance-template"

// Tool configuration exports (LIF-62)
export {
  TOOL_CONFIG_BY_ROLE,
  getToolConfigForRole,
  canDelegate,
} from "./tool-config"
