import { z } from "zod"
import { McpNameSchema } from "../mcp/types"

const PermissionValue = z.enum(["ask", "allow", "deny"])

const BashPermission = z.union([
  PermissionValue,
  z.record(z.string(), PermissionValue),
])

const AgentPermissionSchema = z.object({
  edit: PermissionValue.optional(),
  bash: BashPermission.optional(),
  webfetch: PermissionValue.optional(),
  doom_loop: PermissionValue.optional(),
  external_directory: PermissionValue.optional(),
})

export const BuiltinAgentNameSchema = z.enum([
  "OmO",
  "oracle",
  "librarian",
  "explore",
  "frontend-ui-ux-engineer",
  "document-writer",
  "multimodal-looker",
  "product-strategist",
  "strategic-planner",
  "task-planner",
])

export const OverridableAgentNameSchema = z.enum([
  "build",
  "plan",
  "OmO",
  "OmO-Plan",
  "oracle",
  "librarian",
  "explore",
  "frontend-ui-ux-engineer",
  "document-writer",
  "multimodal-looker",
  "product-strategist",
  "strategic-planner",
  "task-planner",
])

export const AgentNameSchema = BuiltinAgentNameSchema

export const HookNameSchema = z.enum([
  "todo-continuation-enforcer",
  "context-window-monitor",
  "session-recovery",
  "session-notification",
  "comment-checker",
  "grep-output-truncator",
  "tool-output-truncator",
  "directory-agents-injector",
  "directory-readme-injector",
  "empty-task-response-detector",
  "think-mode",
  "anthropic-auto-compact",
  "rules-injector",
  "background-notification",
  "auto-update-checker",
  "startup-toast",
  "keyword-detector",
  "agent-usage-reminder",
  "non-interactive-env",
  "interactive-bash-session",
  "governance-path-validator",
  "governance-historian",
  "governance-linear-injector",
  "governance-docs-delegation",
  "hook-health-manager",
  "git-safety-validator",
  "security-scanner",
  "conflict-detector",
  "workflow-state-enforcer",
])

export const AgentOverrideConfigSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  prompt: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  disable: z.boolean().optional(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  permission: AgentPermissionSchema.optional(),
})

export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  OmO: AgentOverrideConfigSchema.optional(),
  "OmO-Plan": AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  "frontend-ui-ux-engineer": AgentOverrideConfigSchema.optional(),
  "document-writer": AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
  "product-strategist": AgentOverrideConfigSchema.optional(),
  "strategic-planner": AgentOverrideConfigSchema.optional(),
  "task-planner": AgentOverrideConfigSchema.optional(),
})

export const ClaudeCodeConfigSchema = z.object({
  mcp: z.boolean().optional(),
  commands: z.boolean().optional(),
  skills: z.boolean().optional(),
  agents: z.boolean().optional(),
  hooks: z.boolean().optional(),
})

export const OmoAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
})

// Governance configuration schemas
export const GovernancePathValidationSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["warn", "block", "disabled"]).default("warn"),
  allowed_paths: z.array(z.string()).default([
    "context/specs/",
    "context/memory/",
    ".cursor/specs/",
    ".cursor/memory/",
    ".opencode/",
    "src/",
    "tests/",
    "docs/",
    "lib/",
    "packages/",
  ]),
})

export const GovernanceHistorianSchema = z.object({
  enabled: z.boolean().default(true),
  auto_create: z.boolean().default(true),
  changelog_path: z.string().default("changelog/"),
  min_changes: z.number().default(1),
})

export const LinearPolicySchema = z.enum(["off", "optional", "required"])

export const GovernanceLinearSchema = z.object({
  enabled: z.boolean().default(true),
  team_prefix: z.string().default("LIF"),
  cache_issues: z.boolean().default(true),
  policy: LinearPolicySchema.default("optional"),
})

export const GovernanceHookHealthSchema = z.object({
  enabled: z.boolean().default(true),
  circuit_breaker_threshold: z.number().default(3),
  slow_hook_threshold_ms: z.number().default(1000),
  metrics_retention_count: z.number().default(100),
  enable_metrics: z.boolean().default(true),
  log_warnings: z.boolean().default(true),
})

export const GovernanceGitSafetySchema = z.object({
  enabled: z.boolean().default(true),
  protected_branches: z.array(z.string()).default(["main", "master", "production", "prod"]),
  block_force_operations: z.boolean().default(true),
  warn_on_destructive: z.boolean().default(true),
  allow_list_patterns: z.array(z.string()).default([]),
})

export const GovernanceSecurityScannerSchema = z.object({
  enabled: z.boolean().default(true),
  scan_on_write: z.boolean().default(true),
  scan_on_edit: z.boolean().default(true),
  mask_in_output: z.boolean().default(true),
  allow_list_patterns: z.array(z.string()).default([]),
})

export const GovernanceConflictDetectorSchema = z.object({
  enabled: z.boolean().default(true),
  lock_timeout_ms: z.number().default(60000),
  warn_on_conflict: z.boolean().default(true),
  block_on_conflict: z.boolean().default(false),
})

export const GovernanceDocsBlockingSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["warn", "block", "disabled"]).default("block"),
})

export const GovernanceArtifactTruncationSchema = z.object({
  enabled: z.boolean().default(true),
  max_summary_tokens: z.number().default(200),
  max_output_chars: z.number().default(4000),
  keep_task_metadata: z.boolean().default(true),
})

export const GovernanceDelegationComplianceSchema = z.object({
  enabled: z.boolean().default(false),
  track_violations: z.boolean().default(true),
  strikes_to_block: z.number().default(3),
})

export const WorkflowStateEnforcerSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["warn", "block", "disabled"]).default("warn"),
  workflow_agents: z.record(z.string(), z.string()).default({
    "/specify": "product-strategist",
    "/plan": "strategic-planner",
    "/tasks": "task-planner",
  }),
  prerequisites: z.record(z.string(), z.array(z.string())).default({
    "/plan": ["spec.md"],
    "/tasks": ["plan.md"],
    "/implement": ["tasks.md"],
    "/review": ["spec.md"],
    "/test": ["spec.md"],
  }),
})

export const OrchestrationConfigSchema = z.object({
  max_turns: z.number().default(10),
  max_delegation_depth: z.number().default(5),
  detect_loops: z.boolean().default(true),
  warn_on_deep_chain: z.boolean().default(true),
  retry_max_attempts: z.number().default(3),
  retry_initial_delay_ms: z.number().default(1000),
  retry_max_delay_ms: z.number().default(30000),
})

export const GovernanceConfigSchema = z.object({
  path_validation: GovernancePathValidationSchema.optional(),
  historian: GovernanceHistorianSchema.optional(),
  linear: GovernanceLinearSchema.optional(),
  hook_health: GovernanceHookHealthSchema.optional(),
  git_safety: GovernanceGitSafetySchema.optional(),
  security_scanner: GovernanceSecurityScannerSchema.optional(),
  conflict_detector: GovernanceConflictDetectorSchema.optional(),
  orchestration: OrchestrationConfigSchema.optional(),
  docs_blocking: GovernanceDocsBlockingSchema.optional(),
  artifact_truncation: GovernanceArtifactTruncationSchema.optional(),
  delegation_compliance: GovernanceDelegationComplianceSchema.optional(),
  workflow_state_enforcer: WorkflowStateEnforcerSchema.optional(),
})

export const OhMyOpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  disabled_mcps: z.array(McpNameSchema).optional(),
  disabled_agents: z.array(BuiltinAgentNameSchema).optional(),
  disabled_hooks: z.array(HookNameSchema).optional(),
  agents: AgentOverridesSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  google_auth: z.boolean().optional(),
  omo_agent: OmoAgentConfigSchema.optional(),
  governance: GovernanceConfigSchema.optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>
export type AgentName = z.infer<typeof AgentNameSchema>
export type HookName = z.infer<typeof HookNameSchema>
export type OmoAgentConfig = z.infer<typeof OmoAgentConfigSchema>
export type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>
export type GovernancePathValidationConfig = z.infer<typeof GovernancePathValidationSchema>
export type GovernanceHistorianConfig = z.infer<typeof GovernanceHistorianSchema>
export type GovernanceLinearConfig = z.infer<typeof GovernanceLinearSchema>
export type GovernanceHookHealthConfig = z.infer<typeof GovernanceHookHealthSchema>
export type GovernanceGitSafetyConfig = z.infer<typeof GovernanceGitSafetySchema>
export type GovernanceSecurityScannerConfig = z.infer<typeof GovernanceSecurityScannerSchema>
export type GovernanceConflictDetectorConfig = z.infer<typeof GovernanceConflictDetectorSchema>
export type GovernanceDocsBlockingConfig = z.infer<typeof GovernanceDocsBlockingSchema>
export type GovernanceArtifactTruncationConfig = z.infer<typeof GovernanceArtifactTruncationSchema>
export type GovernanceDelegationComplianceConfig = z.infer<typeof GovernanceDelegationComplianceSchema>
export type OrchestrationConfig = z.infer<typeof OrchestrationConfigSchema>
export type LinearPolicy = z.infer<typeof LinearPolicySchema>
export type WorkflowStateEnforcerConfig = z.infer<typeof WorkflowStateEnforcerSchema>

export { McpNameSchema, type McpName } from "../mcp/types"
