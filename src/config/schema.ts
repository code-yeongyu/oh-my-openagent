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
  "sisyphus",
  "hephaestus",
  "prometheus",
  "oracle",
  "librarian",
  "explore",
  "implementer",
  "archiver",
  "frontend-ui-ux-engineer",
  "document-writer",
  "multimodal-looker",
  "metis",
  "momus",
  "atlas",
  "observer",
])


export const BuiltinSkillNameSchema = z.enum([
  "playwright",
  "agent-browser",
  "frontend-ui-ux",
  "git-master",
])

export const OverridableAgentNameSchema = z.enum([
  "build",
  "plan",
  "sisyphus",
  "hephaestus",
  "sisyphus-junior",
  "OpenCode-Builder",
  "prometheus",
  "metis",
  "momus",
  "oracle",
  "librarian",
  "explore",
  "implementer",
  "archiver",
  "frontend-ui-ux-engineer",
  "document-writer",
  "multimodal-looker",
  "atlas",
  "observer",
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
  "preemptive-compaction",
  "rules-injector",
  "background-notification",
  "background-compaction",
  "auto-update-checker",
  "startup-toast",
  "keyword-detector",
  "agent-usage-reminder",
  "agent-skill-reminder",
  "non-interactive-env",
  "interactive-bash-session",

  "thinking-block-validator",
  "ralph-loop",
  "category-skill-reminder",

  "compaction-context-injector",
  "claude-code-hooks",
  "auto-slash-command",
  "edit-error-recovery",
  "delegate-task-retry",
  "prometheus-md-only",
  "sisyphus-junior-notepad",
  "notepad-write-guard",
  "start-work",
  "atlas",
  "sisyphus-orchestrator",
  "tdd-guard",
  "debugging-injector",
  "failure-counter",
  "skill-suggestion",
  "planning-flow-guide",
  "lsp-diagnostics-enforcer",
  "subagent-verification",
  "codebase-assessment",
  "phase-flow-enforcer",
  "plan-reorganizer",
  "plan-update-reminder",
  "plan-attention-refresher",
  "mdsel-reminder",
  "mdsel-enforcer",
  "observation-recorder",
  "observer-detector",
  "instinct-trigger",
  "instinct-learner",
  "pattern-extraction",
  "observation-write-guard",
  "secret-scanner",
  "skill-auto-injector",
  "behavior-anchor",
  "verbosity-controller",
  "phase-rules-injector",
  "knowledge-injection",
  "project-context-injector",
  "pr-context-injector",
  "unstable-agent-babysitter",
  "stop-continuation-guard",
  "tasks-todowrite-disabler",
])

export const BuiltinCommandNameSchema = z.enum([
  "init-deep",
  "start-work",
])

export const AgentOverrideConfigSchema = z.object({
  /** @deprecated Use `category` instead. Model is inherited from category defaults. */
  model: z.string().optional(),
  variant: z.string().optional(),
  /** Category name to inherit model and other settings from CategoryConfig */
  category: z.string().optional(),
  /** Skill names to inject into agent prompt */
  skills: z.array(z.string()).optional(),
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
  /** Maximum tokens for response. Passed directly to OpenCode SDK. */
  maxTokens: z.number().optional(),
  /** Extended thinking configuration (Anthropic). Overrides category and default settings. */
  thinking: z.object({
    type: z.enum(["enabled", "disabled"]),
    budgetTokens: z.number().optional(),
  }).optional(),
  /** Reasoning effort level (OpenAI). Overrides category and default settings. */
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  /** Text verbosity level. */
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  /** Provider-specific options. Passed directly to OpenCode SDK. */
  providerOptions: z.record(z.string(), z.unknown()).optional(),
})

export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  sisyphus: AgentOverrideConfigSchema.optional(),
  hephaestus: AgentOverrideConfigSchema.optional(),
  "sisyphus-junior": AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  prometheus: AgentOverrideConfigSchema.optional(),
  metis: AgentOverrideConfigSchema.optional(),
  momus: AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  implementer: AgentOverrideConfigSchema.optional(),
  archiver: AgentOverrideConfigSchema.optional(),
  "frontend-ui-ux-engineer": AgentOverrideConfigSchema.optional(),
  "document-writer": AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
  atlas: AgentOverrideConfigSchema.optional(),
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

export const CategoryConfigSchema = z.object({
  /** Human-readable description of the category's purpose. Shown in delegate_task prompt. */
  description: z.string().optional(),
  model: z.string().optional(),
  variant: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: z.object({
    type: z.enum(["enabled", "disabled"]),
    budgetTokens: z.number().optional(),
  }).optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  prompt_append: z.string().optional(),
  /** Default skills to inject when using this category */
  defaultSkills: z.array(z.string()).optional(),
  /** Mark agent as unstable - forces background mode for monitoring. Auto-enabled for gemini/minimax models. */
  is_unstable_agent: z.boolean().optional(),
})

export const BuiltinCategoryNameSchema = z.enum([
  "visual-engineering",
  "ultrabrain",
  "deep",
  "artistry",
  "quick",
  "unspecified-low",
  "unspecified-high",
  "writing",
])

export const CategoriesConfigSchema = z.record(z.string(), CategoryConfigSchema)

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
    "lsp_rename",
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
  preemptive_compaction: z.boolean().optional(),
  /** Truncate all tool outputs, not just whitelisted tools (default: false). Tool output truncator is enabled by default - disable via disabled_hooks. */
  truncate_all_tool_outputs: z.boolean().optional(),
  /** Dynamic context pruning configuration */
  dynamic_context_pruning: DynamicContextPruningConfigSchema.optional(),
  /** Enable experimental task system for Todowrite disabler hook */
  task_system: z.boolean().optional(),
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

export const BackgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional(),
  providerConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  modelConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  /** Stale timeout in milliseconds - interrupt tasks with no activity for this duration (default: 180000 = 3 minutes, minimum: 60000 = 1 minute) */
  staleTimeoutMs: z.number().min(60000).optional(),
})

export const NotificationConfigSchema = z.object({
  /** Force enable session-notification even if external notification plugins are detected (default: false) */
  force_enable: z.boolean().optional(),
})

export const BabysittingConfigSchema = z.object({
  timeout_ms: z.number().default(120000),
})

export const GitMasterConfigSchema = z.object({
  /** Add "Ultraworked with Sisyphus" footer to commit messages (default: true) */
  commit_footer: z.boolean().default(true),
  /** Add "Co-authored-by: Sisyphus" trailer to commit messages (default: true) */
  include_co_authored_by: z.boolean().default(true),
})

export const BrowserAutomationProviderSchema = z.enum(["playwright", "agent-browser", "dev-browser"])

export const BrowserAutomationConfigSchema = z.object({
  /**
   * Browser automation provider to use for the "playwright" skill.
   * - "playwright": Uses Playwright MCP server (@playwright/mcp) - default
   * - "agent-browser": Uses Vercel's agent-browser CLI (requires: bun add -g agent-browser)
   * - "dev-browser": Uses dev-browser skill with persistent browser state
   */
  provider: BrowserAutomationProviderSchema.default("playwright"),
})

export const WebsearchProviderSchema = z.enum(["exa", "tavily"])

export const WebsearchConfigSchema = z.object({
  /**
   * Websearch provider to use.
   * - "exa": Uses Exa websearch (default, works without API key)
   * - "tavily": Uses Tavily websearch (requires TAVILY_API_KEY)
   */
  provider: WebsearchProviderSchema.optional(),
})

export const TmuxLayoutSchema = z.enum([
  "main-horizontal",  // main pane top, agent panes bottom stack
  "main-vertical",    // main pane left, agent panes right stack (default)
  "tiled",            // all panes same size grid
  "even-horizontal",  // all panes horizontal row
  "even-vertical",    // all panes vertical stack
])

export const TmuxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  layout: TmuxLayoutSchema.default("main-vertical"),
  main_pane_size: z.number().min(20).max(80).default(60),
  main_pane_min_width: z.number().min(40).default(120),
  agent_pane_min_width: z.number().min(20).default(40),
})

export const McpTemplateConfigSchema = z.union([
  z.string(), // Shorthand: just the template name, e.g., "exa"
  z.object({
    /** Template name to use (e.g., "exa", "tavily", "firecrawl") */
    template: z.string(),
    /** API key (optional if env var is set) */
    apiKey: z.string().optional(),
    /** Override the default URL */
    url: z.string().optional(),
    /** Additional headers */
    headers: z.record(z.string(), z.string()).optional(),
  }),
])

export const McpConfigSchema = z.object({
  /** Maximum number of MCP tools before warning (default: 80) */
  tool_count_warning_threshold: z.number().min(1).default(80),
  /** 
   * MCP Templates - activate preset MCPs by just providing a name or API key.
   * Example: { "my-search": "exa" } or { "my-search": { template: "exa", apiKey: "..." } }
   */
  templates: z.record(z.string(), McpTemplateConfigSchema).optional(),
})

export const RiskTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])

export const TddGuardConfigSchema = z.object({
  /** Enable TDD Guard Hook (default: false) */
  enabled: z.boolean().optional(),
  /** Enable Risk Tier based validation (default: true) */
  risk_tier_enabled: z.boolean().optional(),
  /** Minimum tier to enforce TDD (default: 2) */
  min_enforce_tier: RiskTierSchema.optional(),
  /** Glob patterns to ignore (default: ["*.md", "*.json", "*.yaml", "*.css"]) */
  ignore_patterns: z.array(z.string()).optional(),
  /** Reject tests with empty body (default: true) */
  reject_empty_tests: z.boolean().optional(),
  /** Reject tests without assertions (default: true) */
  reject_missing_assertions: z.boolean().optional(),
  /** Reject trivial assertions like expect(true).toBe(true) (default: true) */
  reject_trivial_assertions: z.boolean().optional(),
  /** Inject TDD Skill when edit is blocked (default: true) */
  inject_skill_on_block: z.boolean().optional(),
})

export const CheckboxEnforcementConfigSchema = z.object({
  /** Enable checkbox update enforcement (default: true) */
  enabled: z.boolean().default(true),
})

export const SisyphusTasksConfigSchema = z.object({
  /** Absolute or relative storage path override. When set, bypasses global config dir. */
  storage_path: z.string().optional(),
  /** Force task list ID (alternative to env ULTRAWORK_TASK_LIST_ID) */
  task_list_id: z.string().optional(),
  /** Enable Claude Code path compatibility mode */
  claude_code_compat: z.boolean().default(false),
})

export const SisyphusConfigSchema = z.object({
  tasks: SisyphusTasksConfigSchema.optional(),
})
export const OhMyOpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Enable new task system (default: false) */
  new_task_system_enabled: z.boolean().optional(),
  /** Default agent name for `oh-my-opencode run` (env: OPENCODE_DEFAULT_AGENT) */
  default_run_agent: z.string().optional(),
  disabled_mcps: z.array(AnyMcpNameSchema).optional(),
  disabled_agents: z.array(BuiltinAgentNameSchema).optional(),
  disabled_skills: z.array(BuiltinSkillNameSchema).optional(),
  disabled_hooks: z.array(HookNameSchema).optional(),
  disabled_commands: z.array(BuiltinCommandNameSchema).optional(),
  /** Disable specific tools by name (e.g., ["todowrite", "todoread"]) */
  disabled_tools: z.array(z.string()).optional(),
  agents: AgentOverridesSchema.optional(),
  categories: CategoriesConfigSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  sisyphus_agent: SisyphusAgentConfigSchema.optional(),
  comment_checker: CommentCheckerConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  auto_update: z.boolean().optional(),
  skills: SkillsConfigSchema.optional(),
  ralph_loop: RalphLoopConfigSchema.optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  babysitting: BabysittingConfigSchema.optional(),
  git_master: GitMasterConfigSchema.optional(),
  browser_automation_engine: BrowserAutomationConfigSchema.optional(),
  websearch: WebsearchConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
  tdd_guard: TddGuardConfigSchema.optional(),
  checkbox_enforcement: CheckboxEnforcementConfigSchema.optional(),
  mcp: McpConfigSchema.optional(),
  sisyphus: SisyphusConfigSchema.optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>
export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>
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
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>
export type BabysittingConfig = z.infer<typeof BabysittingConfigSchema>
export type CategoryConfig = z.infer<typeof CategoryConfigSchema>
export type CategoriesConfig = z.infer<typeof CategoriesConfigSchema>
export type BuiltinCategoryName = z.infer<typeof BuiltinCategoryNameSchema>
export type GitMasterConfig = z.infer<typeof GitMasterConfigSchema>
export type BrowserAutomationProvider = z.infer<typeof BrowserAutomationProviderSchema>
export type BrowserAutomationConfig = z.infer<typeof BrowserAutomationConfigSchema>
export type WebsearchProvider = z.infer<typeof WebsearchProviderSchema>
export type WebsearchConfig = z.infer<typeof WebsearchConfigSchema>
export type TmuxConfig = z.infer<typeof TmuxConfigSchema>
export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>
export type TddGuardConfig = z.infer<typeof TddGuardConfigSchema>
export type RiskTier = z.infer<typeof RiskTierSchema>
export type CheckboxEnforcementConfig = z.infer<typeof CheckboxEnforcementConfigSchema>
export type McpConfig = z.infer<typeof McpConfigSchema>
export type SisyphusTasksConfig = z.infer<typeof SisyphusTasksConfigSchema>
export type SisyphusConfig = z.infer<typeof SisyphusConfigSchema>

export { AnyMcpNameSchema, type AnyMcpName, McpNameSchema, type McpName } from "../mcp/types"
