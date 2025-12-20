import type { Plugin } from "@opencode-ai/plugin";
import { createBuiltinAgents } from "./agents";
import {
  createTodoContinuationEnforcer,
  createContextWindowMonitorHook,
  createSessionRecoveryHook,
  createSessionNotification,
  createCommentCheckerHooks,
  createToolOutputTruncatorHook,
  createDirectoryAgentsInjectorHook,
  createDirectoryReadmeInjectorHook,
  createEmptyTaskResponseDetectorHook,
  createThinkModeHook,
  createClaudeCodeHooksHook,
  createAnthropicAutoCompactHook,
  createRulesInjectorHook,
  createBackgroundNotificationHook,
  createAutoUpdateCheckerHook,
  createKeywordDetectorHook,
  createAgentUsageReminderHook,
  createNonInteractiveEnvHook,
  createInteractiveBashSessionHook,
  createGovernancePathValidatorHook,
  createGovernanceHistorianHook,
  createGovernanceLinearInjectorHook,
  createGovernanceDocsDelegationHook,
  HookHealthManager,
  createGitSafetyValidatorHook,
  createSecurityScannerHook,
  createConflictDetectorHook,
} from "./hooks";
import { createGoogleAntigravityAuthPlugin } from "./auth/antigravity";
import {
  loadUserCommands,
  loadProjectCommands,
  loadOpencodeGlobalCommands,
  loadOpencodeProjectCommands,
} from "./features/claude-code-command-loader";
import {
  loadUserSkillsAsCommands,
  loadProjectSkillsAsCommands,
} from "./features/claude-code-skill-loader";
import {
  loadUserAgents,
  loadProjectAgents,
} from "./features/claude-code-agent-loader";
import { loadMcpConfigs } from "./features/claude-code-mcp-loader";
import {
  setCurrentSession,
  setMainSession,
  getMainSessionID,
  getCurrentSessionTitle,
} from "./features/claude-code-session-state";
import { updateTerminalTitle } from "./features/terminal";
import {
  builtinTools,
  createCallOmoAgent,
  createBackgroundTools,
  createLookAt,
  interactive_bash,
  getTmuxPath,
  // Governance tools
  createLinearBranchTool,
  createLinearUpdateStatusTool,
  createLinearCreateIssueTool,
  createReadContextTool,
  createSpecFolderTool,
  updateWorkflowStateTool,
} from "./tools";
import { BackgroundManager } from "./features/background-agent";
import { createBuiltinMcps } from "./mcp";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig, type HookName } from "./config";
import { log, deepMerge } from "./shared";
import { MaxTurnsEnforcer } from "./features/orchestration";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Returns the user-level config directory based on the OS.
 * - Linux/macOS: XDG_CONFIG_HOME or ~/.config
 * - Windows: %APPDATA%
 */
function getUserConfigDir(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }

  // Linux, macOS, and other Unix-like systems: respect XDG_CONFIG_HOME
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

const AGENT_NAME_MAP: Record<string, string> = {
  omo: "OmO",
  build: "build",
  oracle: "oracle",
  librarian: "librarian",
  explore: "explore",
  "frontend-ui-ux-engineer": "frontend-ui-ux-engineer",
  "document-writer": "document-writer",
  "multimodal-looker": "multimodal-looker",
};

function normalizeAgentNames(agents: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(agents)) {
    const normalizedKey = AGENT_NAME_MAP[key.toLowerCase()] ?? key;
    normalized[normalizedKey] = value;
  }
  return normalized;
}

function loadConfigFromPath(configPath: string): OhMyOpenCodeConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const rawConfig = JSON.parse(content);

      if (rawConfig.agents && typeof rawConfig.agents === "object") {
        rawConfig.agents = normalizeAgentNames(rawConfig.agents);
      }

      const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig);

      if (!result.success) {
        log(`Config validation error in ${configPath}:`, result.error.issues);
        return null;
      }

      log(`Config loaded from ${configPath}`, { agents: result.data.agents });
      return result.data;
    }
  } catch (err) {
    log(`Error loading config from ${configPath}:`, err);
  }
  return null;
}

function mergeConfigs(
  base: OhMyOpenCodeConfig,
  override: OhMyOpenCodeConfig
): OhMyOpenCodeConfig {
  return {
    ...base,
    ...override,
    agents: deepMerge(base.agents, override.agents),
    disabled_agents: [
      ...new Set([
        ...(base.disabled_agents ?? []),
        ...(override.disabled_agents ?? []),
      ]),
    ],
    disabled_mcps: [
      ...new Set([
        ...(base.disabled_mcps ?? []),
        ...(override.disabled_mcps ?? []),
      ]),
    ],
    disabled_hooks: [
      ...new Set([
        ...(base.disabled_hooks ?? []),
        ...(override.disabled_hooks ?? []),
      ]),
    ],
    claude_code: deepMerge(base.claude_code, override.claude_code),
  };
}

function loadPluginConfig(directory: string): OhMyOpenCodeConfig {
  // User-level config path (OS-specific)
  const userConfigPath = path.join(
    getUserConfigDir(),
    "opencode",
    "oh-my-opencode.json"
  );

  // Project-level config path
  const projectConfigPath = path.join(
    directory,
    ".opencode",
    "oh-my-opencode.json"
  );

  // Load user config first (base)
  let config: OhMyOpenCodeConfig = loadConfigFromPath(userConfigPath) ?? {};

  // Override with project config
  const projectConfig = loadConfigFromPath(projectConfigPath);
  if (projectConfig) {
    config = mergeConfigs(config, projectConfig);
  }

  log("Final merged config", {
    agents: config.agents,
    disabled_agents: config.disabled_agents,
    disabled_mcps: config.disabled_mcps,
    disabled_hooks: config.disabled_hooks,
    claude_code: config.claude_code,
  });
  return config;
}

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  const pluginConfig = loadPluginConfig(ctx.directory);
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);
  const isHookEnabled = (hookName: HookName) => !disabledHooks.has(hookName);

  const hookHealthConfig = pluginConfig.governance?.hook_health;
  const hookHealthManager = isHookEnabled("hook-health-manager")
    ? HookHealthManager.getInstance({
        circuitBreakerThreshold: hookHealthConfig?.circuit_breaker_threshold,
        slowHookThresholdMs: hookHealthConfig?.slow_hook_threshold_ms,
        metricsRetentionCount: hookHealthConfig?.metrics_retention_count,
        enableMetrics: hookHealthConfig?.enable_metrics,
        logWarnings: hookHealthConfig?.log_warnings,
      })
    : null;

  async function safeHookCall<T>(
    hookName: string,
    fn: () => Promise<T> | T
  ): Promise<T | undefined> {
    if (!hookHealthManager) {
      try {
        return await fn();
      } catch (err) {
        log(`[Hook Error] ${hookName}:`, err);
        return undefined;
      }
    }

    const result = await hookHealthManager.executeWithHealth(hookName, fn);
    if (result.skipped) {
      log(`[Hook Skipped] ${hookName}: ${result.skipReason}`);
    }
    return result.result;
  }

  const todoContinuationEnforcer = isHookEnabled("todo-continuation-enforcer")
    ? createTodoContinuationEnforcer(ctx)
    : null;
  const contextWindowMonitor = isHookEnabled("context-window-monitor")
    ? createContextWindowMonitorHook(ctx)
    : null;
  const sessionRecovery = isHookEnabled("session-recovery")
    ? createSessionRecoveryHook(ctx)
    : null;
  const sessionNotification = isHookEnabled("session-notification")
    ? createSessionNotification(ctx)
    : null;

  // Wire up recovery state tracking between session-recovery and todo-continuation-enforcer
  // This prevents the continuation enforcer from injecting prompts during active recovery
  if (sessionRecovery && todoContinuationEnforcer) {
    sessionRecovery.setOnAbortCallback(todoContinuationEnforcer.markRecovering);
    sessionRecovery.setOnRecoveryCompleteCallback(todoContinuationEnforcer.markRecoveryComplete);
  }

  const commentChecker = isHookEnabled("comment-checker")
    ? createCommentCheckerHooks()
    : null;
  const toolOutputTruncator = isHookEnabled("tool-output-truncator")
    ? createToolOutputTruncatorHook(ctx)
    : null;
  const directoryAgentsInjector = isHookEnabled("directory-agents-injector")
    ? createDirectoryAgentsInjectorHook(ctx)
    : null;
  const directoryReadmeInjector = isHookEnabled("directory-readme-injector")
    ? createDirectoryReadmeInjectorHook(ctx)
    : null;
  const emptyTaskResponseDetector = isHookEnabled("empty-task-response-detector")
    ? createEmptyTaskResponseDetectorHook(ctx)
    : null;
  const thinkMode = isHookEnabled("think-mode")
    ? createThinkModeHook()
    : null;
  const claudeCodeHooks = createClaudeCodeHooksHook(ctx, {
    disabledHooks: (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
  });
  const anthropicAutoCompact = isHookEnabled("anthropic-auto-compact")
    ? createAnthropicAutoCompactHook(ctx)
    : null;
  const rulesInjector = isHookEnabled("rules-injector")
    ? createRulesInjectorHook(ctx)
    : null;
  const autoUpdateChecker = isHookEnabled("auto-update-checker")
    ? createAutoUpdateCheckerHook(ctx, {
        showStartupToast: isHookEnabled("startup-toast"),
      })
    : null;
  const keywordDetector = isHookEnabled("keyword-detector")
    ? createKeywordDetectorHook()
    : null;
  const agentUsageReminder = isHookEnabled("agent-usage-reminder")
    ? createAgentUsageReminderHook(ctx)
    : null;
  const nonInteractiveEnv = isHookEnabled("non-interactive-env")
    ? createNonInteractiveEnvHook(ctx)
    : null;
  const interactiveBashSession = isHookEnabled("interactive-bash-session")
    ? createInteractiveBashSessionHook(ctx)
    : null;

  // Governance hooks
  const governancePathValidator = isHookEnabled("governance-path-validator")
    ? createGovernancePathValidatorHook(ctx, pluginConfig.governance?.path_validation)
    : null;
  const governanceHistorian = isHookEnabled("governance-historian")
    ? createGovernanceHistorianHook(ctx, pluginConfig.governance?.historian)
    : null;
  const governanceLinearInjector = isHookEnabled("governance-linear-injector")
    ? createGovernanceLinearInjectorHook(ctx, pluginConfig.governance?.linear)
    : null;
  const governanceDocsDelegation = isHookEnabled("governance-docs-delegation")
    ? createGovernanceDocsDelegationHook(ctx, pluginConfig.governance?.docs_blocking)
    : null;

  // Safety hooks (LIF-63)
  const gitSafetyValidator = isHookEnabled("git-safety-validator")
    ? createGitSafetyValidatorHook(ctx, {
        protectedBranches: pluginConfig.governance?.git_safety?.protected_branches,
        blockForceOperations: pluginConfig.governance?.git_safety?.block_force_operations,
        warnOnDestructive: pluginConfig.governance?.git_safety?.warn_on_destructive,
        allowListPatterns: pluginConfig.governance?.git_safety?.allow_list_patterns,
      })
    : null;
  const securityScanner = isHookEnabled("security-scanner")
    ? createSecurityScannerHook(ctx, {
        enabled: pluginConfig.governance?.security_scanner?.enabled,
        scanOnWrite: pluginConfig.governance?.security_scanner?.scan_on_write,
        scanOnEdit: pluginConfig.governance?.security_scanner?.scan_on_edit,
        maskInOutput: pluginConfig.governance?.security_scanner?.mask_in_output,
        allowListPatterns: pluginConfig.governance?.security_scanner?.allow_list_patterns,
      })
    : null;
  const conflictDetector = isHookEnabled("conflict-detector")
    ? createConflictDetectorHook(ctx, {
        enabled: pluginConfig.governance?.conflict_detector?.enabled,
        lockTimeoutMs: pluginConfig.governance?.conflict_detector?.lock_timeout_ms,
        warnOnConflict: pluginConfig.governance?.conflict_detector?.warn_on_conflict,
        blockOnConflict: pluginConfig.governance?.conflict_detector?.block_on_conflict,
      })
    : null;

  updateTerminalTitle({ sessionId: "main" });

  const backgroundManager = new BackgroundManager(ctx);

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? createBackgroundNotificationHook(backgroundManager)
    : null;
  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const callOmoAgent = createCallOmoAgent(ctx, backgroundManager, pluginConfig);
  const lookAt = createLookAt(ctx);

  // Governance tools
  const linearBranch = createLinearBranchTool(ctx);
  const linearUpdateStatus = createLinearUpdateStatusTool(ctx);
  const linearCreateIssue = createLinearCreateIssueTool(ctx);
  const readContext = createReadContextTool(ctx);
  const createSpecFolder = createSpecFolderTool(ctx);
  const updateWorkflowState = updateWorkflowStateTool(ctx);

  const googleAuthHooks = pluginConfig.google_auth
    ? await createGoogleAntigravityAuthPlugin(ctx)
    : null;

  const tmuxAvailable = await getTmuxPath();

  return {
    ...(googleAuthHooks ? { auth: googleAuthHooks.auth } : {}),

    tool: {
      ...builtinTools,
      ...backgroundTools,
      call_omo_agent: callOmoAgent,
      look_at: lookAt,
      // Governance tools
      linear_branch: linearBranch,
      linear_update_status: linearUpdateStatus,
      linear_create_issue: linearCreateIssue,
      read_context: readContext,
      create_spec_folder: createSpecFolder,
      update_workflow_state: updateWorkflowState,
      ...(tmuxAvailable ? { interactive_bash } : {}),
    },

    "chat.message": async (input, output) => {
      await claudeCodeHooks["chat.message"]?.(input, output);
      await keywordDetector?.["chat.message"]?.(input, output);
      // Governance: Linear context injection
      await governanceLinearInjector?.["chat.message"]?.(input, output);
    },

    config: async (config) => {
      const builtinAgents = createBuiltinAgents(
        pluginConfig.disabled_agents,
        pluginConfig.agents,
        ctx.directory,
      );

      const userAgents = (pluginConfig.claude_code?.agents ?? true) ? loadUserAgents() : {};
      const projectAgents = (pluginConfig.claude_code?.agents ?? true) ? loadProjectAgents(ctx.directory) : {};

      const isOmoEnabled = pluginConfig.omo_agent?.disabled !== true;

      if (isOmoEnabled && builtinAgents.OmO) {
        // TODO: When OpenCode releases `default_agent` config option (PR #5313),
        // use `config.default_agent = "OmO"` instead of demoting build/plan.
        // Tracking: https://github.com/sst/opencode/pull/5313
        const { name: _planName, ...planConfigWithoutName } = config.agent?.plan ?? {};
        const omoPlanOverride = pluginConfig.agents?.["OmO-Plan"];
        const omoPlanBase = {
          ...builtinAgents.OmO,
          ...planConfigWithoutName,
          description: `${config.agent?.plan?.description ?? "Plan agent"} (OhMyOpenCode version)`,
          color: config.agent?.plan?.color ?? "#6495ED",
        };

        const omoPlanConfig = omoPlanOverride ? deepMerge(omoPlanBase, omoPlanOverride) : omoPlanBase;

        config.agent = {
          OmO: builtinAgents.OmO,
          "OmO-Plan": omoPlanConfig,
          ...Object.fromEntries(Object.entries(builtinAgents).filter(([k]) => k !== "OmO")),
          ...userAgents,
          ...projectAgents,
          ...config.agent,
          build: { ...config.agent?.build, mode: "subagent" },
          plan: { ...config.agent?.plan, mode: "subagent" },
        };
      } else {
        config.agent = {
          ...builtinAgents,
          ...userAgents,
          ...projectAgents,
          ...config.agent,
        };
      }

      config.tools = {
        ...config.tools,
      };

      if (config.agent.explore) {
        config.agent.explore.tools = {
          ...config.agent.explore.tools,
          call_omo_agent: false,
        };
      }
      if (config.agent.librarian) {
        config.agent.librarian.tools = {
          ...config.agent.librarian.tools,
          call_omo_agent: false,
        };
      }
      if (config.agent["multimodal-looker"]) {
        config.agent["multimodal-looker"].tools = {
          ...config.agent["multimodal-looker"].tools,
          task: false,
          call_omo_agent: false,
          look_at: false,
        };
      }

      const mcpResult = (pluginConfig.claude_code?.mcp ?? true)
        ? await loadMcpConfigs(ctx.directory)
        : { servers: {} };
      config.mcp = {
        ...config.mcp,
        ...createBuiltinMcps(pluginConfig.disabled_mcps),
        ...mcpResult.servers,
      };

      const userCommands = (pluginConfig.claude_code?.commands ?? true) ? loadUserCommands() : {};
      const opencodeGlobalCommands = loadOpencodeGlobalCommands();
      const systemCommands = config.command ?? {};
      const projectCommands = (pluginConfig.claude_code?.commands ?? true) ? loadProjectCommands(ctx.directory) : {};
      const opencodeProjectCommands = loadOpencodeProjectCommands(ctx.directory);
      const userSkills = (pluginConfig.claude_code?.skills ?? true) ? loadUserSkillsAsCommands() : {};
      const projectSkills = (pluginConfig.claude_code?.skills ?? true) ? loadProjectSkillsAsCommands(ctx.directory) : {};

      config.command = {
        ...userCommands,
        ...userSkills,
        ...opencodeGlobalCommands,
        ...systemCommands,
        ...projectCommands,
        ...projectSkills,
        ...opencodeProjectCommands,
      };
    },

    event: async (input) => {
      await autoUpdateChecker?.event(input);
      await claudeCodeHooks.event(input);
      await backgroundNotificationHook?.event(input);
      await sessionNotification?.(input);
      await todoContinuationEnforcer?.handler(input);
      await contextWindowMonitor?.event(input);
      await directoryAgentsInjector?.event(input);
      await directoryReadmeInjector?.event(input);
      await rulesInjector?.event(input);
      await thinkMode?.event(input);
      await anthropicAutoCompact?.event(input);
      await keywordDetector?.event(input);
      await agentUsageReminder?.event(input);
      await interactiveBashSession?.event(input);
      // Governance: Historian and Linear injector events
      await governanceHistorian?.event(input);
      await governanceLinearInjector?.event(input);

      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.created") {
        const sessionInfo = props?.info as
          | { id?: string; title?: string; parentID?: string }
          | undefined;
        if (!sessionInfo?.parentID) {
          setMainSession(sessionInfo?.id);
          setCurrentSession(sessionInfo?.id, sessionInfo?.title);
          updateTerminalTitle({
            sessionId: sessionInfo?.id || "main",
            status: "idle",
            directory: ctx.directory,
            sessionTitle: sessionInfo?.title,
          });
          
          if (sessionInfo?.id) {
            MaxTurnsEnforcer.getInstance(sessionInfo.id, {
              maxTurns: 100,
              warnAtTurn: 80,
            });
          }
        }
      }

      if (event.type === "session.updated") {
        const sessionInfo = props?.info as
          | { id?: string; title?: string; parentID?: string }
          | undefined;
        if (!sessionInfo?.parentID) {
          setCurrentSession(sessionInfo?.id, sessionInfo?.title);
          updateTerminalTitle({
            sessionId: sessionInfo?.id || "main",
            status: "processing",
            directory: ctx.directory,
            sessionTitle: sessionInfo?.title,
          });
        }
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          MaxTurnsEnforcer.removeInstance(sessionInfo.id);
          
          if (sessionInfo.id === getMainSessionID()) {
            setMainSession(undefined);
            setCurrentSession(undefined, undefined);
            updateTerminalTitle({
              sessionId: "main",
              status: "idle",
            });
          }
        }
      }

      if (event.type === "session.error") {
        const sessionID = props?.sessionID as string | undefined;
        const error = props?.error;

        if (sessionRecovery?.isRecoverableError(error)) {
          const messageInfo = {
            id: props?.messageID as string | undefined,
            role: "assistant" as const,
            sessionID,
            error,
          };
          const recovered =
            await sessionRecovery.handleSessionRecovery(messageInfo);

          if (recovered && sessionID && sessionID === getMainSessionID()) {
            await ctx.client.session
              .prompt({
                path: { id: sessionID },
                body: { parts: [{ type: "text", text: "continue" }] },
                query: { directory: ctx.directory },
              })
              .catch(() => {});
          }
        }

        if (sessionID && sessionID === getMainSessionID()) {
          updateTerminalTitle({
            sessionId: sessionID,
            status: "error",
            directory: ctx.directory,
            sessionTitle: getCurrentSessionTitle(),
          });
        }
      }

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined;
        if (sessionID && sessionID === getMainSessionID()) {
          updateTerminalTitle({
            sessionId: sessionID,
            status: "idle",
            directory: ctx.directory,
            sessionTitle: getCurrentSessionTitle(),
          });
        }
      }
      
      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined;
        const sessionID = info?.sessionID as string | undefined;
        
        if (sessionID && info?.role === "assistant") {
          const enforcer = MaxTurnsEnforcer.getInstance(sessionID);
          enforcer.incrementTurn();
        }
      }
    },

    "tool.execute.before": async (input, output) => {
      await claudeCodeHooks["tool.execute.before"](input, output);
      await nonInteractiveEnv?.["tool.execute.before"](input, output);
      await safeHookCall("comment-checker", () => commentChecker?.["tool.execute.before"](input, output));
      
      // Validation hooks that may throw (run BEFORE lock acquisition)
      await gitSafetyValidator?.["tool.execute.before"](input, output);
      await securityScanner?.["tool.execute.before"](input, output);
      await governancePathValidator?.["tool.execute.before"](input, output);
      await governanceDocsDelegation?.["tool.execute.before"](input, output);
      
      // Lock acquisition (run AFTER all validation hooks to prevent lock leaks)
      await conflictDetector?.["tool.execute.before"](input, output);

      if (input.tool === "task") {
        const args = output.args as Record<string, unknown>;
        const subagentType = args.subagent_type as string;
        const isExploreOrLibrarian = ["explore", "librarian"].includes(subagentType);

        args.tools = {
          ...(args.tools as Record<string, boolean> | undefined),
          background_task: false,
          ...(isExploreOrLibrarian ? { call_omo_agent: false } : {}),
        };
      }

      if (input.sessionID === getMainSessionID()) {
        updateTerminalTitle({
          sessionId: input.sessionID,
          status: "tool",
          currentTool: input.tool,
          directory: ctx.directory,
          sessionTitle: getCurrentSessionTitle(),
        });
      }
    },

    "tool.execute.after": async (input, output) => {
      await claudeCodeHooks["tool.execute.after"](input, output);
      await safeHookCall("tool-output-truncator", () => toolOutputTruncator?.["tool.execute.after"](input, output));
      await safeHookCall("context-window-monitor", () => contextWindowMonitor?.["tool.execute.after"](input, output));
      await safeHookCall("comment-checker", () => commentChecker?.["tool.execute.after"](input, output));
      await safeHookCall("directory-agents-injector", () => directoryAgentsInjector?.["tool.execute.after"](input, output));
      await safeHookCall("directory-readme-injector", () => directoryReadmeInjector?.["tool.execute.after"](input, output));
      await safeHookCall("rules-injector", () => rulesInjector?.["tool.execute.after"](input, output));
      await safeHookCall("empty-task-response-detector", () => emptyTaskResponseDetector?.["tool.execute.after"](input, output));
      await safeHookCall("agent-usage-reminder", () => agentUsageReminder?.["tool.execute.after"](input, output));
      await safeHookCall("interactive-bash-session", () => interactiveBashSession?.["tool.execute.after"](input, output));
      await securityScanner?.["tool.execute.after"](input, output);
      await conflictDetector?.["tool.execute.after"](input, output);
      await governanceHistorian?.["tool.execute.after"](input, output);

      if (input.sessionID === getMainSessionID()) {
        updateTerminalTitle({
          sessionId: input.sessionID,
          status: "idle",
          directory: ctx.directory,
          sessionTitle: getCurrentSessionTitle(),
        });
      }
    },
  };
};

export default OhMyOpenCodePlugin;

export type {
  OhMyOpenCodeConfig,
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  McpName,
  HookName,
} from "./config";
