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
  "Sisyphus",
  "oracle",
  "librarian",
  "explore",
  "frontend-ui-ux-engineer",
  "document-writer",
  "multimodal-looker",
])

export const OverridableAgentNameSchema = z.enum([
  "build",
  "plan",
  "Sisyphus",
  "OpenCode-Builder",
  "Planner-Sisyphus",
  "oracle",
  "librarian",
  "explore",
  "frontend-ui-ux-engineer",
  "document-writer",
  "multimodal-looker",
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
  "empty-message-sanitizer",
  "thinking-block-validator",
])

export const AgentOverrideConfigSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  prompt: z.string().optional(),
  prompt_append: z.string().optional(),
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
  Sisyphus: AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  "Planner-Sisyphus": AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  "frontend-ui-ux-engineer": AgentOverrideConfigSchema.optional(),
  "document-writer": AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
})

export const ClaudeCodeConfigSchema = z.object({
  mcp: z.boolean().optional(),
  commands: z.boolean().optional(),
  skills: z.boolean().optional(),
  agents: z.boolean().optional(),
  hooks: z.boolean().optional(),
})

export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
})

export const ExperimentalConfigSchema = z.object({
  aggressive_truncation: z.boolean().optional(),
  auto_resume: z.boolean().optional(),
  /** Enable preemptive compaction at threshold (default: true) */
  preemptive_compaction: z.boolean().optional(),
  /** Threshold percentage to trigger preemptive compaction (default: 0.80) */
  preemptive_compaction_threshold: z.number().min(0.5).max(0.95).optional(),
  /** Truncate all tool outputs, not just whitelisted tools (default: true) */
  truncate_all_tool_outputs: z.boolean().default(true),
})

export const OhMyOpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  disabled_mcps: z.array(McpNameSchema).optional(),
  disabled_agents: z.array(BuiltinAgentNameSchema).optional(),
  disabled_hooks: z.array(HookNameSchema).optional(),
  agents: AgentOverridesSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  google_auth: z.boolean().optional(),
  sisyphus_agent: SisyphusAgentConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  auto_update: z.boolean().optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>
export type AgentName = z.infer<typeof AgentNameSchema>
export type HookName = z.infer<typeof HookNameSchema>
export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>
export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>

export { McpNameSchema, type McpName } from "../mcp/types"
