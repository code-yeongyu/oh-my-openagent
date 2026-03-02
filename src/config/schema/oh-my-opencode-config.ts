import { z } from "zod"
import { AnyMcpNameSchema } from "../../mcp/types"
import { BuiltinAgentNameSchema, BuiltinSkillNameSchema } from "./agent-names"
import { AgentOverridesSchema } from "./agent-overrides"
import { BabysittingConfigSchema } from "./babysitting"
import { BackgroundTaskConfigSchema } from "./background-task"
import { BrowserAutomationConfigSchema } from "./browser-automation"
import { CategoriesConfigSchema } from "./categories"
import { ClaudeCodeConfigSchema } from "./claude-code"
import { CommentCheckerConfigSchema } from "./comment-checker"
import { BuiltinCommandNameSchema } from "./commands"
import { ExperimentalConfigSchema } from "./experimental"
import { GitMasterConfigSchema } from "./git-master"
import { NotificationConfigSchema } from "./notification"
import { RalphLoopConfigSchema } from "./ralph-loop"
import { RuntimeFallbackConfigSchema } from "./runtime-fallback"
import { SkillsConfigSchema } from "./skills"
import { SisyphusConfigSchema } from "./sisyphus"
import { SisyphusAgentConfigSchema } from "./sisyphus-agent"
import { TmuxConfigSchema } from "./tmux"
import { WebsearchConfigSchema } from "./websearch"

export const OhMyOpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Enable new task system (default: false) */
  new_task_system_enabled: z.boolean().optional(),
  /** Default agent name for `oh-my-opencode run` (env: OPENCODE_DEFAULT_AGENT) */
  default_run_agent: z.string().optional(),
  disabled_mcps: z.array(AnyMcpNameSchema).optional(),
  disabled_agents: z.array(z.string()).optional(),
  disabled_skills: z.array(BuiltinSkillNameSchema).optional(),
  disabled_hooks: z.array(z.string()).optional(),
  /** Grouped cadence control: configure firing frequency for logical hook groups */
  hook_cadence: z.object({
    /** How to use delegation tools (agent-usage-reminder, category-skill-reminder, atlas). Default: 2 */
    tool_guidance: z.number().int().positive().default(2).optional(),
    /** Project rules, directory READMEs, agents, start-work prompts. Default: 3 */
    context_injection: z.number().int().positive().default(3).optional(),
    /** Task reminders, notepad reminders, anthropic-effort. Default: 3 */
    reminders: z.number().int().positive().default(3).optional(),
    /** Todo continuation enforcer. Default: 2 */
    continuation: z.number().int().positive().default(2).optional(),
    /** Error recovery hooks (edit, JSON, delegate-task, session, context-window-limit). Default: 1 */
    error_recovery: z.number().int().positive().default(1).optional(),
  }).optional(),
  disabled_commands: z.array(BuiltinCommandNameSchema).optional(),
  /** Disable specific tools by name (e.g., ["todowrite", "todoread"]) */
  disabled_tools: z.array(z.string()).optional(),
  /** Enable hashline_edit tool/hook integrations (default: false) */
  hashline_edit: z.boolean().optional(),
  /** Enable model fallback on API errors (default: false). Set to true to enable automatic model switching when model errors occur. */
  model_fallback: z.boolean().optional(),
  agents: AgentOverridesSchema.optional(),
  categories: CategoriesConfigSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  sisyphus_agent: SisyphusAgentConfigSchema.optional(),
  comment_checker: CommentCheckerConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  auto_update: z.boolean().optional(),
  skills: SkillsConfigSchema.optional(),
  ralph_loop: RalphLoopConfigSchema.optional(),
  /**
   * Enable runtime fallback (default: false)
   * Set to false to disable, or use object for advanced config:
   * { "enabled": true, "retry_on_errors": [400, 429], "timeout_seconds": 30 }
   */
  runtime_fallback: z.union([z.boolean(), RuntimeFallbackConfigSchema]).optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  babysitting: BabysittingConfigSchema.optional(),
  git_master: GitMasterConfigSchema.optional(),
  browser_automation_engine: BrowserAutomationConfigSchema.optional(),
  websearch: WebsearchConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
  sisyphus: SisyphusConfigSchema.optional(),
  /** Migration history to prevent re-applying migrations (e.g., model version upgrades) */
  _migrations: z.array(z.string()).optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
