import { z } from "zod"
import { AnyMcpNameSchema, McpNameSchema } from "../mcp/types"

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

export const BuiltinSkillNameSchema = z.enum([
  "playwright",
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
  "anthropic-context-window-limit-recovery",
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
  "ralph-loop",
  "preemptive-compaction",
  "compaction-context-injector",
  "claude-code-hooks",
  "auto-slash-command",
  "edit-error-recovery",
])

export const BuiltinCommandNameSchema = z.enum([
  "init-deep",
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
  plugins: z.boolean().optional(),
  plugins_override: z.record(z.string(), z.boolean()).optional(),
})

export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
})

export const CommentCheckerConfigSchema = z.object({
  /** Custom prompt to replace the default warning message. Use {{comments}} placeholder for detected comments XML. */
  custom_prompt: z.string().optional(),
})

export const DynamicContextPruningConfigSchema = z.object({
  /** Enable dynamic context pruning (default: false) */
  enabled: z.boolean().default(false),
  /** Notification level: off, minimal, or detailed (default: detailed) */
  notification: z.enum(["off", "minimal", "detailed"]).default("detailed"),
  /** Turn protection - prevent pruning recent tool outputs */
  turn_protection: z.object({
    enabled: z.boolean().default(true),
    turns: z.number().min(1).max(10).default(3),
  }).optional(),
  /** Tools that should never be pruned */
  protected_tools: z.array(z.string()).default([
    "task", "todowrite", "todoread",
    "lsp_rename", "lsp_code_action_resolve",
    "session_read", "session_write", "session_search",
  ]),
  /** Pruning strategies configuration */
  strategies: z.object({
    /** Remove duplicate tool calls (same tool + same args) */
    deduplication: z.object({
      enabled: z.boolean().default(true),
    }).optional(),
    /** Prune write inputs when file subsequently read */
    supersede_writes: z.object({
      enabled: z.boolean().default(true),
      /** Aggressive mode: prune any write if ANY subsequent read */
      aggressive: z.boolean().default(false),
    }).optional(),
    /** Prune errored tool inputs after N turns */
    purge_errors: z.object({
      enabled: z.boolean().default(true),
      turns: z.number().min(1).max(20).default(5),
    }).optional(),
  }).optional(),
})

export const ExperimentalConfigSchema = z.object({
  aggressive_truncation: z.boolean().optional(),
  auto_resume: z.boolean().optional(),
  /** Enable preemptive compaction at threshold (default: true since v2.9.0) */
  preemptive_compaction: z.boolean().optional(),
  /** Threshold percentage to trigger preemptive compaction (default: 0.80) */
  preemptive_compaction_threshold: z.number().min(0.5).max(0.95).optional(),
  /** Truncate all tool outputs, not just whitelisted tools (default: false). Tool output truncator is enabled by default - disable via disabled_hooks. */
  truncate_all_tool_outputs: z.boolean().optional(),
  /** Dynamic context pruning configuration */
  dynamic_context_pruning: DynamicContextPruningConfigSchema.optional(),
  /** Enable DCP (Dynamic Context Pruning) for compaction - runs first when token limit exceeded (default: false) */
  dcp_for_compaction: z.boolean().optional(),
})

export const SkillSourceSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    recursive: z.boolean().optional(),
    glob: z.string().optional(),
  }),
])

export const SkillDefinitionSchema = z.object({
  description: z.string().optional(),
  template: z.string().optional(),
  from: z.string().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
  subtask: z.boolean().optional(),
  "argument-hint": z.string().optional(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  "allowed-tools": z.array(z.string()).optional(),
  disable: z.boolean().optional(),
})

export const SkillEntrySchema = z.union([
  z.boolean(),
  SkillDefinitionSchema,
])

export const SkillsConfigSchema = z.union([
  z.array(z.string()),
  z.record(z.string(), SkillEntrySchema).and(z.object({
    sources: z.array(SkillSourceSchema).optional(),
    enable: z.array(z.string()).optional(),
    disable: z.array(z.string()).optional(),
  }).partial()),
])

export const RalphLoopConfigSchema = z.object({
  /** Enable ralph loop functionality (default: false - opt-in feature) */
  enabled: z.boolean().default(false),
  /** Default max iterations if not specified in command (default: 100) */
  default_max_iterations: z.number().min(1).max(1000).default(100),
  /** Custom state file directory relative to project root (default: .opencode/) */
  state_dir: z.string().optional(),
})

export const OhMyOpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  disabled_mcps: z.array(AnyMcpNameSchema).optional(),
  disabled_agents: z.array(BuiltinAgentNameSchema).optional(),
  disabled_skills: z.array(BuiltinSkillNameSchema).optional(),
  disabled_hooks: z.array(HookNameSchema).optional(),
  disabled_commands: z.array(BuiltinCommandNameSchema).optional(),
  agents: AgentOverridesSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  google_auth: z.boolean().optional(),
  sisyphus_agent: SisyphusAgentConfigSchema.optional(),
  comment_checker: CommentCheckerConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  auto_update: z.boolean().optional(),
  skills: SkillsConfigSchema.optional(),
  ralph_loop: RalphLoopConfigSchema.optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>
export type AgentName = z.infer<typeof AgentNameSchema>
export type HookName = z.infer<typeof HookNameSchema>
export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
export type BuiltinSkillName = z.infer<typeof BuiltinSkillNameSchema>
export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>
export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>
export type DynamicContextPruningConfig = z.infer<typeof DynamicContextPruningConfigSchema>
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>
export type RalphLoopConfig = z.infer<typeof RalphLoopConfigSchema>

export { AnyMcpNameSchema, type AnyMcpName, McpNameSchema, type McpName } from "../mcp/types"
