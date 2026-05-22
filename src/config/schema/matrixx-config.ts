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
import { TddEnforcerConfigSchema } from "./tdd-enforcer"
import { HookNameSchema } from "./hooks"
import { SecurityConfigSchema } from "./security"
import { NotificationConfigSchema } from "./notification"
import { MatrixLoopConfigSchema } from "./matrix-loop"
import { SkillsConfigSchema } from "./skills"
import { MorpheusConfigSchema } from "./morpheus"
import { MorpheusAgentConfigSchema } from "./morpheus-agent"
import { TmuxConfigSchema } from "./tmux"
import { WebsearchConfigSchema } from "./websearch"
import { RuntimeFallbackConfigSchema } from "./runtime-fallback"
import { AgentDefinitionsConfigSchema } from "./agent-definitions"
import { ModelCapabilitiesConfigSchema } from "./model-capabilities"

export const MatrixxConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Predefined model profile: "free" | "budget" | "economy" | "balanced" | "performance". Expanded at config load time; explicit agents/categories override profile defaults. */
  profile: z.enum(["free", "budget", "economy", "balanced", "performance"]).optional(),
  /** Enable new task system (default: false) */
  new_task_system_enabled: z.boolean().optional(),
  /** Default agent name for `matrixx run` (env: OPENCODE_DEFAULT_AGENT) */
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
  morpheus_agent: MorpheusAgentConfigSchema.optional(),
  comment_checker: CommentCheckerConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  auto_update: z.boolean().optional(),
  skills: SkillsConfigSchema.optional(),
  matrix_loop: MatrixLoopConfigSchema.optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  babysitting: BabysittingConfigSchema.optional(),
  git_master: GitMasterConfigSchema.optional(),
  tdd_enforcer: TddEnforcerConfigSchema.optional(),
  browser_automation_engine: BrowserAutomationConfigSchema.optional(),
  websearch: WebsearchConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
  morpheus: MorpheusConfigSchema.optional(),
  /** Security scanning, secret detection, and sensitive file guards */
  security: SecurityConfigSchema.optional(),
  runtime_fallback: RuntimeFallbackConfigSchema.optional(),
  /** Paths to external agent definition files */
  agent_definitions: AgentDefinitionsConfigSchema.optional(),
  /** Dynamic model capabilities refresh configuration */
  model_capabilities: ModelCapabilitiesConfigSchema.optional(),
  /** Migration history to prevent re-applying migrations (e.g., model version upgrades) */
  _migrations: z.array(z.string()).optional(),
})

export type MatrixxConfig = z.infer<typeof MatrixxConfigSchema>
