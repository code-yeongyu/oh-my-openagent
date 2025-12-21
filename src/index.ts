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
  createPreemptiveCompactionHook,
  createCompactionContextInjector,
  createRulesInjectorHook,
  createBackgroundNotificationHook,
  createAutoUpdateCheckerHook,
  createKeywordDetectorHook,
  createAgentUsageReminderHook,
  createNonInteractiveEnvHook,
  createInteractiveBashSessionHook,
  createEmptyMessageSanitizerHook,
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
  setMainSession,
  getMainSessionID,
} from "./features/claude-code-session-state";
import { builtinTools, createCallOmoAgent, createBackgroundTools, createLookAt, interactive_bash, getTmuxPath } from "./tools";
import { BackgroundManager } from "./features/background-agent";
import { createBuiltinMcps } from "./mcp";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig, type HookName } from "./config";
import { log, deepMerge, getUserConfigDir, addConfigLoadError } from "./shared";
import { PLAN_SYSTEM_PROMPT, PLAN_PERMISSION } from "./agents/plan-prompt";
import * as fs from "fs";
import * as path from "path";

// Migration map: old keys → new keys (for backward compatibility)
const AGENT_NAME_MAP: Record<string, string> = {
  // Legacy names (backward compatibility)
  omo: "Sisyphus",
  "OmO": "Sisyphus",
  "OmO-Plan": "Planner-Sisyphus",
  "omo-plan": "Planner-Sisyphus",
  // Current names
  sisyphus: "Sisyphus",
  "planner-sisyphus": "Planner-Sisyphus",
  build: "build",
  oracle: "oracle",
  librarian: "librarian",
  explore: "explore",
  "frontend-ui-ux-engineer": "frontend-ui-ux-engineer",
  "document-writer": "document-writer",
  "multimodal-looker": "multimodal-looker",
};

function migrateAgentNames(agents: Record<string, unknown>): { migrated: Record<string, unknown>; changed: boolean } {
  const migrated: Record<string, unknown> = {};
  let changed = false;

  for (const [key, value] of Object.entries(agents)) {
    const newKey = AGENT_NAME_MAP[key.toLowerCase()] ?? AGENT_NAME_MAP[key] ?? key;
    if (newKey !== key) {
      changed = true;
    }
    migrated[newKey] = value;
  }

  return { migrated, changed };
}

function migrateConfigFile(configPath: string, rawConfig: Record<string, unknown>): boolean {
  let needsWrite = false;

  if (rawConfig.agents && typeof rawConfig.agents === "object") {
    const { migrated, changed } = migrateAgentNames(rawConfig.agents as Record<string, unknown>);
    if (changed) {
      rawConfig.agents = migrated;
      needsWrite = true;
    }
  }

  if (rawConfig.omo_agent) {
    rawConfig.sisyphus_agent = rawConfig.omo_agent;
    delete rawConfig.omo_agent;
    needsWrite = true;
  }

  if (needsWrite) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");
      log(`Migrated config file: ${configPath} (OmO → Sisyphus)`);
    } catch (err) {
      log(`Failed to write migrated config to ${configPath}:`, err);
    }
  }

  return needsWrite;
}

function loadConfigFromPath(configPath: string): OhMyOpenCodeConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const rawConfig = JSON.parse(content);

      migrateConfigFile(configPath, rawConfig);

      const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig);

      if (!result.success) {
        const errorMsg = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ");
        log(`Config validation error in ${configPath}:`, result.error.issues);
        addConfigLoadError({ path: configPath, error: `Validation error: ${errorMsg}` });
        return null;
      }

      log(`Config loaded from ${configPath}`, { agents: result.data.agents });
      return result.data;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Error loading config from ${configPath}:`, err);
    addConfigLoadError({ path: configPath, error: errorMsg });
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

  const modelContextLimitsCache = new Map<string, number>();
  let anthropicContext1MEnabled = false;

  const getModelLimit = (providerID: string, modelID: string): number | undefined => {
    const key = `${providerID}/${modelID}`;
    const cached = modelContextLimitsCache.get(key);
    if (cached) return cached;

    if (providerID === "anthropic" && anthropicContext1MEnabled && modelID.includes("sonnet")) {
      return 1_000_000;
    }
    return undefined;
  };

  const todoContinuationEnforcer = isHookEnabled("todo-continuation-enforcer")
    ? createTodoContinuationEnforcer(ctx)
    : null;
  const contextWindowMonitor = isHookEnabled("context-window-monitor")
    ? createContextWindowMonitorHook(ctx)
    : null;
  const sessionRecovery = isHookEnabled("session-recovery")
    ? createSessionRecoveryHook(ctx, { experimental: pluginConfig.experimental })
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
    ? createAnthropicAutoCompactHook(ctx, { experimental: pluginConfig.experimental })
    : null;
  const compactionContextInjector = createCompactionContextInjector();
  const preemptiveCompaction = createPreemptiveCompactionHook(ctx, {
    experimental: pluginConfig.experimental,
    onBeforeSummarize: compactionContextInjector,
    getModelLimit,
  });
  const rulesInjector = isHookEnabled("rules-injector")
    ? createRulesInjectorHook(ctx)
    : null;
  const autoUpdateChecker = isHookEnabled("auto-update-checker")
    ? createAutoUpdateCheckerHook(ctx, {
        showStartupToast: isHookEnabled("startup-toast"),
        isSisyphusEnabled: pluginConfig.sisyphus_agent?.disabled !== true,
        autoUpdate: pluginConfig.auto_update ?? true,
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
  const emptyMessageSanitizer = isHookEnabled("empty-message-sanitizer")
    ? createEmptyMessageSanitizerHook()
    : null;

  const backgroundManager = new BackgroundManager(ctx);

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? createBackgroundNotificationHook(backgroundManager)
    : null;
  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const callOmoAgent = createCallOmoAgent(ctx, backgroundManager);
  const lookAt = createLookAt(ctx);

  const googleAuthHooks = pluginConfig.google_auth !== false
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
      ...(tmuxAvailable ? { interactive_bash } : {}),
    },

    "chat.message": async (input, output) => {
      await claudeCodeHooks["chat.message"]?.(input, output);
      await keywordDetector?.["chat.message"]?.(input, output);
    },

    "experimental.chat.messages.transform": async (
      input: Record<string, never>,
      output: { messages: Array<{ info: unknown; parts: unknown[] }> }
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await emptyMessageSanitizer?.["experimental.chat.messages.transform"]?.(input, output as any);
    },

    config: async (config) => {
      type ProviderConfig = {
        options?: { headers?: Record<string, string> }
        models?: Record<string, { limit?: { context?: number } }>
      }
      const providers = config.provider as Record<string, ProviderConfig> | undefined;

      const anthropicBeta = providers?.anthropic?.options?.headers?.["anthropic-beta"];
      anthropicContext1MEnabled = anthropicBeta?.includes("context-1m") ?? false;

      if (providers) {
        for (const [providerID, providerConfig] of Object.entries(providers)) {
          const models = providerConfig?.models;
          if (models) {
            for (const [modelID, modelConfig] of Object.entries(models)) {
              const contextLimit = modelConfig?.limit?.context;
              if (contextLimit) {
                modelContextLimitsCache.set(`${providerID}/${modelID}`, contextLimit);
              }
            }
          }


        }
      }

      const builtinAgents = createBuiltinAgents(
        pluginConfig.disabled_agents,
        pluginConfig.agents,
        ctx.directory,
        config.model,
      );

      const userAgents = (pluginConfig.claude_code?.agents ?? true) ? loadUserAgents() : {};
      const projectAgents = (pluginConfig.claude_code?.agents ?? true) ? loadProjectAgents() : {};

      const isSisyphusEnabled = pluginConfig.sisyphus_agent?.disabled !== true;

      if (isSisyphusEnabled && builtinAgents.Sisyphus) {
        // TODO: When OpenCode releases `default_agent` config option (PR #5313),
        // use `config.default_agent = "Sisyphus"` instead of demoting build/plan.
        // Tracking: https://github.com/sst/opencode/pull/5313
        const { name: _planName, ...planConfigWithoutName } = config.agent?.plan ?? {};
        const plannerSisyphusOverride = pluginConfig.agents?.["Planner-Sisyphus"];
        const plannerSisyphusBase = {
          ...planConfigWithoutName,
          prompt: PLAN_SYSTEM_PROMPT,
          permission: PLAN_PERMISSION,
          description: `${config.agent?.plan?.description ?? "Plan agent"} (OhMyOpenCode version)`,
          color: config.agent?.plan?.color ?? "#6495ED",
        };

        const plannerSisyphusConfig = plannerSisyphusOverride
          ? { ...plannerSisyphusBase, ...plannerSisyphusOverride }
          : plannerSisyphusBase;

        config.agent = {
          Sisyphus: builtinAgents.Sisyphus,
          "Planner-Sisyphus": plannerSisyphusConfig,
          ...Object.fromEntries(Object.entries(builtinAgents).filter(([k]) => k !== "Sisyphus")),
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

      config.permission = {
        ...config.permission,
        webfetch: "allow",
        external_directory: "allow",
      }

      const mcpResult = (pluginConfig.claude_code?.mcp ?? true)
        ? await loadMcpConfigs()
        : { servers: {} };
      config.mcp = {
        ...config.mcp,
        ...createBuiltinMcps(pluginConfig.disabled_mcps),
        ...mcpResult.servers,
      };

      const userCommands = (pluginConfig.claude_code?.commands ?? true) ? loadUserCommands() : {};
      const opencodeGlobalCommands = loadOpencodeGlobalCommands();
      const systemCommands = config.command ?? {};
      const projectCommands = (pluginConfig.claude_code?.commands ?? true) ? loadProjectCommands() : {};
      const opencodeProjectCommands = loadOpencodeProjectCommands();
      const userSkills = (pluginConfig.claude_code?.skills ?? true) ? loadUserSkillsAsCommands() : {};
      const projectSkills = (pluginConfig.claude_code?.skills ?? true) ? loadProjectSkillsAsCommands() : {};

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
      await preemptiveCompaction?.event(input);
      await agentUsageReminder?.event(input);
      await interactiveBashSession?.event(input);

      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.created") {
        const sessionInfo = props?.info as
          | { id?: string; title?: string; parentID?: string }
          | undefined;
        if (!sessionInfo?.parentID) {
          setMainSession(sessionInfo?.id);
        }
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id === getMainSessionID()) {
          setMainSession(undefined);
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
      }
    },

    "tool.execute.before": async (input, output) => {
      await claudeCodeHooks["tool.execute.before"](input, output);
      await nonInteractiveEnv?.["tool.execute.before"](input, output);
      await commentChecker?.["tool.execute.before"](input, output);

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
    },

    "tool.execute.after": async (input, output) => {
      await claudeCodeHooks["tool.execute.after"](input, output);
      await toolOutputTruncator?.["tool.execute.after"](input, output);
      await contextWindowMonitor?.["tool.execute.after"](input, output);
      await commentChecker?.["tool.execute.after"](input, output);
      await directoryAgentsInjector?.["tool.execute.after"](input, output);
      await directoryReadmeInjector?.["tool.execute.after"](input, output);
      await rulesInjector?.["tool.execute.after"](input, output);
      await emptyTaskResponseDetector?.["tool.execute.after"](input, output);
      await agentUsageReminder?.["tool.execute.after"](input, output);
      await interactiveBashSession?.["tool.execute.after"](input, output);
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

// NOTE: Do NOT export functions from main index.ts!
// OpenCode treats ALL exports as plugin instances and calls them.
// Config error utilities are available via "./shared/config-errors" for internal use only.
export type { ConfigLoadError } from "./shared/config-errors";
