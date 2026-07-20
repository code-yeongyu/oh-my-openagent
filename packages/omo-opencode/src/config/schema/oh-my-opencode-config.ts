import { z } from "zod"
import { AnyMcpNameSchema } from "../../mcp/types"
import { AgentDefinitionsConfigSchema } from "./agent-definitions"
import { AgentOverridesSchema } from "./agent-overrides"
import { BabysittingConfigSchema } from "./babysitting"
import { BackgroundTaskConfigSchema } from "./background-task"
import { BrowserAutomationConfigSchema } from "./browser-automation"
import { CategoriesConfigSchema } from "./categories"
import { ClaudeCodeConfigSchema } from "./claude-code"
import { CodegraphConfigSchema } from "./codegraph"
import { CommentCheckerConfigSchema } from "./comment-checker"
import { BuiltinCommandNameSchema } from "./commands"
import { DefaultModeConfigSchema } from "./default-mode"
import { ExperimentalConfigSchema } from "./experimental"
import { GitMasterConfigSchema } from "./git-master"
import { I18nConfigSchema } from "./i18n"
import { KeywordDetectorConfigSchema } from "./keyword-detector"
import { NotificationConfigSchema } from "./notification"
import { OpenClawConfigSchema } from "./openclaw"
import { ModelCapabilitiesConfigSchema } from "./model-capabilities"
import { GoalConfigSchema } from "./goal"
import { MonitorConfigSchema } from "./monitor"
import { RuntimeFallbackConfigSchema } from "./runtime-fallback"
import { TeamModeConfigSchema } from "./team-mode"
import { SkillsConfigSchema } from "./skills"
import { SecurityMissionConfigSchema } from "./security-mission"
import { SisyphusConfigSchema } from "./sisyphus"
import { SisyphusAgentConfigSchema } from "./sisyphus-agent"
import { TmuxConfigSchema } from "./tmux"
import { TuiConfigSchema } from "./tui"
import { StartWorkConfigSchema } from "./start-work"
import { WebsearchConfigSchema } from "./websearch"

export const OhMyOpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Enable new task system (default: false) */
  new_task_system_enabled: z.boolean().optional(),
  /** Default agent name for `oh-my-opencode run` (env: OPENCODE_DEFAULT_AGENT) */
  default_run_agent: z.string().optional(),
  /** Preferred display order for known agents. Invalid names are ignored with a toast warning. */
  agent_order: z.array(z.string().max(128)).max(64).optional(),
  /** Paths to external agent definition files (.md or .json) */
  agent_definitions: AgentDefinitionsConfigSchema,
  disabled_mcps: z.array(AnyMcpNameSchema).optional(),
  disabled_agents: z.array(z.string()).optional(),
  disabled_skills: z.array(z.string()).optional(),
  disabled_hooks: z.array(z.string()).optional(),
  disabled_commands: z.array(BuiltinCommandNameSchema).optional(),
  /** Disable specific tools by name (e.g., ["todowrite", "todoread"]) */
  disabled_tools: z.array(z.string()).optional(),
  /**
   * Provider prefixes to exclude from every agent/category fallback chain at
   * load time. Each entry matches the first slash-separated segment of a model
   * id (e.g., "github-copilot" matches "github-copilot/gpt-5.5"). If a primary
   * `model` references a disabled provider, it is replaced with the first
   * allowed entry from the same chain.
   */
  disabled_providers: z.array(z.string()).optional(),
  mcp_env_allowlist: z.array(z.string()).optional(),
  /** Enable hashline_edit tool/hook integrations (default: false) */
  hashline_edit: z.boolean().optional(),
  /** Enable anonymous telemetry. Default: enabled when omitted. Set to false to disable. Independent of codegraph.telemetry. */
  telemetry: z.boolean().optional().describe("Enable or disable anonymous telemetry. Default: enabled when omitted. Set to false to disable. Independent of codegraph.telemetry."),
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
  goal: GoalConfigSchema.optional(),
  /** Deprecated compatibility shim. Old \`ralph_loop\` key is parsed and migrated to \`goal\` in validate.ts. */
  ralph_loop: z.record(z.string(), z.unknown()).optional(),
  /**
   * Enable runtime fallback (default: false)
   * Set to false to disable, or use object for advanced config:
   * { "enabled": true, "retry_on_errors": [429, 500, 502, 503, 504], "timeout_seconds": 30 }
   */
  runtime_fallback: z.union([z.boolean(), RuntimeFallbackConfigSchema]).optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  model_capabilities: ModelCapabilitiesConfigSchema.optional(),
  openclaw: OpenClawConfigSchema.optional(),
  /** Plugin i18n settings */
  i18n: I18nConfigSchema.optional(),
  monitor: MonitorConfigSchema.optional(),
  codegraph: CodegraphConfigSchema.optional(),
  team_mode: TeamModeConfigSchema.optional(),
  security_mission: SecurityMissionConfigSchema.optional(),
  keyword_detector: KeywordDetectorConfigSchema.optional(),
  babysitting: BabysittingConfigSchema.optional(),
  git_master: GitMasterConfigSchema.default({
    commit_footer: true,
    include_co_authored_by: true,
    git_env_prefix: "GIT_MASTER=1",
  }),
  browser_automation_engine: BrowserAutomationConfigSchema.optional(),
  websearch: WebsearchConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
  tui: TuiConfigSchema.default({ sidebar: { enabled: true } }).optional(),
  sisyphus: SisyphusConfigSchema.optional(),
  start_work: StartWorkConfigSchema.optional(),
  /** Default mode auto-activation settings (ultrawork, goal) */
  default_mode: DefaultModeConfigSchema.optional(),
  /** Migration history to prevent re-applying migrations (e.g., model version upgrades) */
  _migrations: z.array(z.string()).optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
