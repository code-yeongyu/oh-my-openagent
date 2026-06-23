import { z } from "zod";
import { AnyMcpNameSchema } from "../../mcp/types";
import { BuiltinSkillNameSchema } from "./agent-names";
import { AgentOverridesSchema } from "./agent-overrides";
import { BabysittingConfigSchema } from "./babysitting";
import { BackgroundTaskConfigSchema } from "./background-task";
import { BrowserAutomationConfigSchema } from "./browser-automation";
import { CapabilityGatewayConfigSchema } from "./capability-gateway";
import { CategoriesConfigSchema } from "./categories";
import { ClaudeCodeConfigSchema } from "./claude-code";
import { CommentCheckerConfigSchema } from "./comment-checker";
import { BuiltinCommandNameSchema } from "./commands";
import { ExperimentalConfigSchema } from "./experimental";
import { GitMasterConfigSchema } from "./git-master";
import { FinanceBridgeConfigSchema } from "./finance-bridge";
import { IrisBrainConfigSchema } from "./iris-brain"
import { NotificationConfigSchema } from "./notification"
import { OpenClawConfigSchema } from "./openclaw";
import { ModelCapabilitiesConfigSchema } from "./model-capabilities";
import {
  DEFAULT_MEMORY_AGENT_CONFIG,
  MemoryAgentConfigSchema,
} from "./memory-agent";
import { PluginHookBridgeConfigSchema } from "./plugin-hook-bridge";
import { RalphLoopConfigSchema } from "./ralph-loop";
import { McpPersistenceConfigSchema } from "./mcp-persistence";
import { ProbeLabConfigSchema } from "./probe-lab";
import { ReasoningCoreConfigSchema } from "./reasoning-core";
import { RuntimeFallbackConfigSchema } from "./runtime-fallback";
import { SkillsConfigSchema } from "./skills";
import { SisyphusConfigSchema } from "./sisyphus";
import { SisyphusAgentConfigSchema } from "./sisyphus-agent";
import { TmuxConfigSchema } from "./tmux";
import { StartWorkConfigSchema } from "./start-work";
import { WebsearchConfigSchema } from "./websearch";

export const IDMConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Enable new task system (default: false) */
  new_task_system_enabled: z.boolean().optional(),
  /** Default agent name for `idm run` (env: OPENCODE_DEFAULT_AGENT) */
  default_run_agent: z.string().optional(),
  disabled_mcps: z.array(AnyMcpNameSchema).optional(),
  disabled_agents: z.array(z.string()).optional(),
  disabled_skills: z.array(BuiltinSkillNameSchema).optional(),
  /**
   * Per-agent skill denylist. Map of agent name → skill names that the agent must not load.
   * Enforced at the `skill` tool's execute() — invocation throws an error.
   * Example: { "analyst": ["red-team-tactics", "vulnerability-scanner"] }
   */
  disabled_skills_per_agent: z
    .record(z.string(), z.array(z.string()))
    .optional(),
  disabled_hooks: z.array(z.string()).optional(),
  disabled_commands: z.array(BuiltinCommandNameSchema).optional(),
  /** Disable specific tools by name (e.g., ["todowrite", "todoread"]) */
  disabled_tools: z.array(z.string()).optional(),
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
  reasoning_core: ReasoningCoreConfigSchema.optional(),
  /**
   * Enable runtime fallback (default: false)
   * Set to false to disable, or use object for advanced config:
   * { "enabled": true, "retry_on_errors": [400, 429], "timeout_seconds": 30 }
   */
  runtime_fallback: z
    .union([z.boolean(), RuntimeFallbackConfigSchema])
    .optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  memory_agent: MemoryAgentConfigSchema.default(DEFAULT_MEMORY_AGENT_CONFIG),
  model_capabilities: ModelCapabilitiesConfigSchema.optional(),
  /**
   * @deprecated since v3.x. Scheduled removal: v4.0. `createOpenClawHook`
   * is not wired into the hook chain, so this field is a no-op at runtime.
   * Migrate to `task()` with `run_in_background=true`, or `iris-brain`. See
   * `docs/adr/001-openclaw-fate.md`.
   */
  openclaw: OpenClawConfigSchema.optional(),
  babysitting: BabysittingConfigSchema.optional(),
  git_master: GitMasterConfigSchema.default({
    commit_footer: true,
    include_co_authored_by: true,
    git_env_prefix: "GIT_MASTER=1",
  }),
  browser_automation_engine: BrowserAutomationConfigSchema.optional(),
  websearch: WebsearchConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
  sisyphus: SisyphusConfigSchema.optional(),
  start_work: StartWorkConfigSchema.optional(),
  plugin_hook_bridge: PluginHookBridgeConfigSchema.optional(),
  iris_brain: IrisBrainConfigSchema.optional(),
  finance_bridge: FinanceBridgeConfigSchema.optional(),
  capability_gateway: CapabilityGatewayConfigSchema.optional(),
  /** Auto-persist TUI runtime MCP enable/disable toggles to <cwd>/opencode.json (project-local). Works around upstream bug anomalyco/opencode#13763 where the TUI toggle does not survive restart. Default enabled, poll interval 5s. */
  mcp_persistence: McpPersistenceConfigSchema.optional(),
  /** Probe-lab tuning. force_drivers_register=true forces curl_cffi + camoufox driver registration at plugin boot, bypassing the IDM_PROBE_LAB_*_AUTO env-var auto-register path. Use when the env vars cannot be inherited (e.g., the host terminal was launched before launchctl setenv). */
  probe_lab: ProbeLabConfigSchema.optional(),
  /** Migration history to prevent re-applying migrations (e.g., model version upgrades) */
  _migrations: z.array(z.string()).optional(),
});

export type IDMConfig = z.infer<typeof IDMConfigSchema>;
