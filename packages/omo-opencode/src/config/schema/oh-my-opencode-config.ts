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
import { MonitorConfigSchema } from "./monitor"
import { RalphLoopConfigSchema } from "./ralph-loop"
import { RuntimeFallbackConfigSchema } from "./runtime-fallback"
import { TeamModeConfigSchema } from "./team-mode"
import { SkillsConfigSchema } from "./skills"
import { SisyphusConfigSchema } from "./sisyphus"
import { SisyphusAgentConfigSchema } from "./sisyphus-agent"
import { TmuxConfigSchema } from "./tmux"
import { TuiConfigSchema } from "./tui"
import { StartWorkConfigSchema } from "./start-work"
import { WebsearchConfigSchema } from "./websearch"
import { ReasoningCoreConfigSchema } from "./reasoning-core"
import { MemoryAgentConfigSchema } from "./memory-agent"
import { McpPersistenceConfigSchema } from "./mcp-persistence"
import { ProbeLabConfigSchema } from "./probe-lab"

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
  /**
   * Per-agent skill denylist. Map of agent name to skill names that the agent must not load.
   * Enforced at the `skill` tool's execute(). IDM extension.
   */
  disabled_skills_per_agent: z.record(z.string(), z.array(z.string())).optional(),
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
  /** Default mode auto-activation settings (ultrawork, ralph loop) */
  default_mode: DefaultModeConfigSchema.optional(),
  /** ASPIC+ reasoning-core integration (Rust binary at localhost:8080). IDM extension. */
  reasoning_core: ReasoningCoreConfigSchema.optional(),
  /** Multi-tier memory agent (Mem0, claude-mem, Vespa, Voyage, Cohere). IDM extension. */
  memory_agent: MemoryAgentConfigSchema.optional(),
  /** Auto-persist TUI runtime MCP enable/disable toggles to project-local opencode.json. IDM extension. */
  mcp_persistence: McpPersistenceConfigSchema.optional(),
  /** Probe-lab anti-bot research tuning (driver registration, fingerprinting). IDM extension. */
  probe_lab: ProbeLabConfigSchema.optional(),
  /** Migration history to prevent re-applying migrations (e.g., model version upgrades) */
  _migrations: z.array(z.string()).optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
