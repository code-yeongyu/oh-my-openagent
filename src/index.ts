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
  createAnthropicContextWindowLimitRecoveryHook,
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
  createThinkingBlockValidatorHook,
  createRalphLoopHook,
  createAutoSlashCommandHook,
} from "./hooks";
import { createGoogleAntigravityAuthPlugin } from "./auth/antigravity";
import {
  loadUserCommands,
  loadProjectCommands,
  loadOpencodeGlobalCommands,
  loadOpencodeProjectCommands,
} from "./features/claude-code-command-loader";
import { loadBuiltinCommands } from "./features/builtin-commands";
import {
  loadUserSkills,
  loadProjectSkills,
  loadOpencodeGlobalSkills,
  loadOpencodeProjectSkills,
  discoverUserClaudeSkills,
  discoverProjectClaudeSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  mergeSkills,
} from "./features/opencode-skill-loader";
import { createBuiltinSkills } from "./features/builtin-skills";

import {
  loadUserAgents,
  loadProjectAgents,
} from "./features/claude-code-agent-loader";
import { loadMcpConfigs } from "./features/claude-code-mcp-loader";
import { loadAllPluginComponents } from "./features/claude-code-plugin-loader";
import {
  setMainSession,
  getMainSessionID,
} from "./features/claude-code-session-state";
import { builtinTools, createCallOmoAgent, createBackgroundTools, createLookAt, createSkillTool, interactive_bash, getTmuxPath } from "./tools";
import { BackgroundManager } from "./features/background-agent";
import { createBuiltinMcps } from "./mcp";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig, type HookName } from "./config";
import { log, deepMerge, getUserConfigDir, addConfigLoadError, parseJsonc, detectConfigFile, migrateConfigFile } from "./shared";
import { PLAN_SYSTEM_PROMPT, PLAN_PERMISSION } from "./agents/plan-prompt";
import * as fs from "fs";
import * as path from "path";

function loadConfigFromPath(configPath: string, ctx: any): OhMyOpenCodeConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const rawConfig = parseJsonc<Record<string, unknown>>(content);

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
    disabled_commands: [
      ...new Set([
        ...(base.disabled_commands ?? []),
        ...(override.disabled_commands ?? []),
      ]),
    ],
    claude_code: deepMerge(base.claude_code, override.claude_code),
  };
}

function loadPluginConfig(directory: string, ctx: any): OhMyOpenCodeConfig {
  // User-level config path (OS-specific) - prefer .jsonc over .json
  const userBasePath = path.join(getUserConfigDir(), "opencode", "oh-my-opencode");
  const userDetected = detectConfigFile(userBasePath);
  const userConfigPath = userDetected.format !== "none" ? userDetected.path : userBasePath + ".json";

  // Project-level config path - prefer .jsonc over .json
  const projectBasePath = path.join(directory, ".opencode", "oh-my-opencode");
  const projectDetected = detectConfigFile(projectBasePath);
  const projectConfigPath = projectDetected.format !== "none" ? projectDetected.path : projectBasePath + ".json";

  // Load user config first (base)
  let config: OhMyOpenCodeConfig = loadConfigFromPath(userConfigPath, ctx) ?? {};

  // Override with project config
  const projectConfig = loadConfigFromPath(projectConfigPath, ctx);
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
  const pluginConfig = loadPluginConfig(ctx.directory, ctx);
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

  const contextWindowMonitor = isHookEnabled("context-window-monitor")
    ? createContextWindowMonitorHook(ctx)
    : null;
  const sessionRecovery = isHookEnabled("session-recovery")
    ? createSessionRecoveryHook(ctx, { experimental: pluginConfig.experimental })
    : null;
  const sessionNotification = isHookEnabled("session-notification")
    ? createSessionNotification(ctx)
    : null;

  const commentChecker = isHookEnabled("comment-checker")
    ? createCommentCheckerHooks(pluginConfig.comment_checker)
    : null;
  const toolOutputTruncator = isHookEnabled("tool-output-truncator")
    ? createToolOutputTruncatorHook(ctx, { experimental: pluginConfig.experimental })
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
  const anthropicContextWindowLimitRecovery = isHookEnabled("anthropic-context-window-limit-recovery")
    ? createAnthropicContextWindowLimitRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
        dcpForCompaction: pluginConfig.experimental?.dcp_for_compaction,
      })
    : null;
  const compactionContextInjector = isHookEnabled("compaction-context-injector")
    ? createCompactionContextInjector()
    : undefined;
  const preemptiveCompaction = isHookEnabled("preemptive-compaction")
    ? createPreemptiveCompactionHook(ctx, {
        experimental: pluginConfig.experimental,
        onBeforeSummarize: compactionContextInjector,
        getModelLimit,
      })
    : null;
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
    ? createKeywordDetectorHook(ctx)
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
  const thinkingBlockValidator = isHookEnabled("thinking-block-validator")
    ? createThinkingBlockValidatorHook()
    : null;

  const ralphLoop = isHookEnabled("ralph-loop")
    ? createRalphLoopHook(ctx, { config: pluginConfig.ralph_loop })
    : null;

  const autoSlashCommand = isHookEnabled("auto-slash-command")
    ? createAutoSlashCommandHook()
    : null;

  const backgroundManager = new BackgroundManager(ctx);

  const todoContinuationEnforcer = isHookEnabled("todo-continuation-enforcer")
    ? createTodoContinuationEnforcer(ctx, { backgroundManager })
    : null;

  if (sessionRecovery && todoContinuationEnforcer) {
    sessionRecovery.setOnAbortCallback(todoContinuationEnforcer.markRecovering);
    sessionRecovery.setOnRecoveryCompleteCallback(todoContinuationEnforcer.markRecoveryComplete);
  }

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? createBackgroundNotificationHook(backgroundManager)
    : null;
  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const callOmoAgent = createCallOmoAgent(ctx, backgroundManager);
  const lookAt = createLookAt(ctx);
  const builtinSkills = createBuiltinSkills();
  const includeClaudeSkills = pluginConfig.claude_code?.skills !== false;
  const mergedSkills = mergeSkills(
    builtinSkills,
    pluginConfig.skills,
    includeClaudeSkills ? discoverUserClaudeSkills() : [],
    discoverOpencodeGlobalSkills(),
    includeClaudeSkills ? discoverProjectClaudeSkills() : [],
    discoverOpencodeProjectSkills(),
  );
  const skillTool = createSkillTool({ skills: mergedSkills });

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
      skill: skillTool,
      ...(tmuxAvailable ? { interactive_bash } : {}),
    },

    "chat.message": async (input, output) => {
      await claudeCodeHooks["chat.message"]?.(input, output);
      await keywordDetector?.["chat.message"]?.(input, output);
      await autoSlashCommand?.["chat.message"]?.(input, output);

      if (ralphLoop) {
        const parts = (output as { parts?: Array<{ type: string; text?: string }> }).parts;
        const promptText = parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim() || "";

        const isRalphLoopTemplate = promptText.includes("You are starting a Ralph Loop") && 
          promptText.includes("<user-task>");
        const isCancelRalphTemplate = promptText.includes("Cancel the currently active Ralph Loop");

        if (isRalphLoopTemplate) {
          const taskMatch = promptText.match(/<user-task>\s*([\s\S]*?)\s*<\/user-task>/i);
          const rawTask = taskMatch?.[1]?.trim() || "";
          
          const quotedMatch = rawTask.match(/^["'](.+?)["']/);
          const prompt = quotedMatch?.[1] || rawTask.split(/\s+--/)[0]?.trim() || "Complete the task as instructed";

          const maxIterMatch = rawTask.match(/--max-iterations=(\d+)/i);
          const promiseMatch = rawTask.match(/--completion-promise=["']?([^"'\s]+)["']?/i);

          log("[ralph-loop] Starting loop from chat.message", { sessionID: input.sessionID, prompt });
          ralphLoop.startLoop(input.sessionID, prompt, {
            maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
            completionPromise: promiseMatch?.[1],
          });
        } else if (isCancelRalphTemplate) {
          log("[ralph-loop] Cancelling loop from chat.message", { sessionID: input.sessionID });
          ralphLoop.cancelLoop(input.sessionID);
        }
      }
    },

    "experimental.chat.messages.transform": async (
      input: Record<string, never>,
      output: { messages: Array<{ info: unknown; parts: unknown[] }> }
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await thinkingBlockValidator?.["experimental.chat.messages.transform"]?.(input, output as any);
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

      const pluginComponents = (pluginConfig.claude_code?.plugins ?? true)
        ? await loadAllPluginComponents({
            enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
          })
        : { commands: {}, skills: {}, agents: {}, mcpServers: {}, hooksConfigs: [], plugins: [], errors: [] };

      if (pluginComponents.plugins.length > 0) {
        log(`Loaded ${pluginComponents.plugins.length} Claude Code plugins`, {
          plugins: pluginComponents.plugins.map(p => `${p.name}@${p.version}`),
        });
      }

      if (pluginComponents.errors.length > 0) {
        log(`Plugin load errors`, { errors: pluginComponents.errors });
      }

      const builtinAgents = createBuiltinAgents(
        pluginConfig.disabled_agents,
        pluginConfig.agents,
        ctx.directory,
        config.model,
      );

      const userAgents = (pluginConfig.claude_code?.agents ?? true) ? loadUserAgents() : {};
      const projectAgents = (pluginConfig.claude_code?.agents ?? true) ? loadProjectAgents() : {};
      const pluginAgents = pluginComponents.agents;

      const isSisyphusEnabled = pluginConfig.sisyphus_agent?.disabled !== true;
      const builderEnabled = pluginConfig.sisyphus_agent?.default_builder_enabled ?? false;
      const plannerEnabled = pluginConfig.sisyphus_agent?.planner_enabled ?? true;
      const replacePlan = pluginConfig.sisyphus_agent?.replace_plan ?? true;

      if (isSisyphusEnabled && builtinAgents.Sisyphus) {
        // Set Sisyphus as default agent (feature added in OpenCode PR #5843)
        (config as { default_agent?: string }).default_agent = "Sisyphus";

        const agentConfig: Record<string, unknown> = {
          Sisyphus: builtinAgents.Sisyphus,
        };

        if (builderEnabled) {
          const { name: _buildName, ...buildConfigWithoutName } = config.agent?.build ?? {};
          const openCodeBuilderOverride = pluginConfig.agents?.["OpenCode-Builder"];
          const openCodeBuilderBase = {
            ...buildConfigWithoutName,
            description: `${config.agent?.build?.description ?? "Build agent"} (OpenCode default)`,
          };

          agentConfig["OpenCode-Builder"] = openCodeBuilderOverride
            ? { ...openCodeBuilderBase, ...openCodeBuilderOverride }
            : openCodeBuilderBase;
        }

        if (plannerEnabled) {
          const { name: _planName, ...planConfigWithoutName } = config.agent?.plan ?? {};
          const plannerSisyphusOverride = pluginConfig.agents?.["Planner-Sisyphus"];
          const plannerSisyphusBase = {
            ...planConfigWithoutName,
            prompt: PLAN_SYSTEM_PROMPT,
            permission: PLAN_PERMISSION,
            description: `${config.agent?.plan?.description ?? "Plan agent"} (OhMyOpenCode version)`,
            color: config.agent?.plan?.color ?? "#6495ED",
          };

          agentConfig["Planner-Sisyphus"] = plannerSisyphusOverride
            ? { ...plannerSisyphusBase, ...plannerSisyphusOverride }
            : plannerSisyphusBase;
        }

        // Filter out build/plan from config.agent - they'll be re-added as subagents if replaced
        const filteredConfigAgents = config.agent ? 
          Object.fromEntries(
            Object.entries(config.agent).filter(([key]) => {
              if (key === "build") return false;
              if (key === "plan" && replacePlan) return false;
              return true;
            })
          ) : {};

        config.agent = {
          ...agentConfig,
          ...Object.fromEntries(Object.entries(builtinAgents).filter(([k]) => k !== "Sisyphus")),
          ...userAgents,
          ...projectAgents,
          ...pluginAgents,
          ...filteredConfigAgents,  // Filtered config agents (excludes build/plan if replaced)
          // Demote build/plan to subagent mode when replaced
          build: { ...config.agent?.build, mode: "subagent" },
          ...(replacePlan ? { plan: { ...config.agent?.plan, mode: "subagent" } } : {}),
        };
      } else {
        config.agent = {
          ...builtinAgents,
          ...userAgents,
          ...projectAgents,
          ...pluginAgents,
          ...config.agent,
        };
      }

      config.tools = {
        ...config.tools,
        "grep_app_*": false, // Disable grep_app tools globally to reduce token usage (only librarian needs them)
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
          "grep_app_*": true,
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
        ...pluginComponents.mcpServers,
      };

      const builtinCommands = loadBuiltinCommands(pluginConfig.disabled_commands);
      const userCommands = (pluginConfig.claude_code?.commands ?? true) ? loadUserCommands() : {};
      const opencodeGlobalCommands = loadOpencodeGlobalCommands();
      const systemCommands = config.command ?? {};
      const projectCommands = (pluginConfig.claude_code?.commands ?? true) ? loadProjectCommands() : {};
      const opencodeProjectCommands = loadOpencodeProjectCommands();

      const userSkills = (pluginConfig.claude_code?.skills ?? true) ? loadUserSkills() : {};
      const projectSkills = (pluginConfig.claude_code?.skills ?? true) ? loadProjectSkills() : {};
      const opencodeGlobalSkills = loadOpencodeGlobalSkills();
      const opencodeProjectSkills = loadOpencodeProjectSkills();

      config.command = {
        ...builtinCommands,
        ...userCommands,
        ...userSkills,
        ...opencodeGlobalCommands,
        ...opencodeGlobalSkills,
        ...systemCommands,
        ...projectCommands,
        ...projectSkills,
        ...opencodeProjectCommands,
        ...opencodeProjectSkills,
        ...pluginComponents.commands,
        ...pluginComponents.skills,
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
      await anthropicContextWindowLimitRecovery?.event(input);
      await preemptiveCompaction?.event(input);
      await agentUsageReminder?.event(input);
      await interactiveBashSession?.event(input);
      await ralphLoop?.event(input);

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
      await directoryAgentsInjector?.["tool.execute.before"]?.(input, output);
      await directoryReadmeInjector?.["tool.execute.before"]?.(input, output);
      await rulesInjector?.["tool.execute.before"]?.(input, output);

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

      if (ralphLoop && input.tool === "slashcommand") {
        const args = output.args as { command?: string } | undefined;
        const command = args?.command?.replace(/^\//, "").toLowerCase();
        const sessionID = input.sessionID || getMainSessionID();

        if (command === "ralph-loop" && sessionID) {
          const rawArgs = args?.command?.replace(/^\/?(ralph-loop)\s*/i, "") || "";
          const taskMatch = rawArgs.match(/^["'](.+?)["']/);
          const prompt = taskMatch?.[1] || rawArgs.split(/\s+--/)[0]?.trim() || "Complete the task as instructed";

          const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i);
          const promiseMatch = rawArgs.match(/--completion-promise=["']?([^"'\s]+)["']?/i);

          ralphLoop.startLoop(sessionID, prompt, {
            maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
            completionPromise: promiseMatch?.[1],
          });
        } else if (command === "cancel-ralph" && sessionID) {
          ralphLoop.cancelLoop(sessionID);
        }
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
  BuiltinCommandName,
} from "./config";

// NOTE: Do NOT export functions from main index.ts!
// OpenCode treats ALL exports as plugin instances and calls them.
// Config error utilities are available via "./shared/config-errors" for internal use only.
export type { ConfigLoadError } from "./shared/config-errors";
