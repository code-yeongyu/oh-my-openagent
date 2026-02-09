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
import { HookNameSchema } from "./hooks"
import { NotificationConfigSchema } from "./notification"
import { RalphLoopConfigSchema } from "./ralph-loop"
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
  sisyphus: SisyphusConfigSchema.optional(),
  /** Migration history to prevent re-applying migrations (e.g., model version upgrades) */
  _migrations: z.array(z.string()).optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
