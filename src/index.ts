import type { Plugin, ToolDefinition } from "@opencode-ai/plugin";
import type { AvailableSkill } from "./agents/dynamic-agent-prompt-builder";
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
  createRulesInjectorHook,
  createBackgroundNotificationHook,
  createAutoUpdateCheckerHook,
  createKeywordDetectorHook,
  createAgentUsageReminderHook,
  createNonInteractiveEnvHook,
  createInteractiveBashSessionHook,
  createThinkingBlockValidatorHook,
  createCategorySkillReminderHook,
  createRalphLoopHook,
  createAutoSlashCommandHook,
  createEditErrorRecoveryHook,
  createDelegateTaskRetryHook,
  createTaskResumeInfoHook,
  createStartWorkHook,
  createAtlasHook,
  createPrometheusMdOnlyHook,
  createSisyphusJuniorNotepadHook,
  createQuestionLabelTruncatorHook,
  createSubagentQuestionBlockerHook,
  createStopContinuationGuardHook,
  createCompactionContextInjector,
  createCompactionTodoPreserverHook,
  createUnstableAgentBabysitterHook,
  createPreemptiveCompactionHook,
  createTasksTodowriteDisablerHook,
  createWriteExistingFileGuardHook,
} from "./hooks";
import { createAnthropicEffortHook } from "./hooks/anthropic-effort";
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from "./features/context-injector";
import {
  applyAgentVariant,
  resolveAgentVariant,
  resolveVariantForModel,
} from "./shared/agent-variant";
import { createFirstMessageVariantGate } from "./shared/first-message-variant";
import {
  discoverUserClaudeSkills,
  discoverProjectClaudeSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  mergeSkills,
} from "./features/opencode-skill-loader";
import type { SkillScope } from "./features/opencode-skill-loader/types";
import { createBuiltinSkills } from "./features/builtin-skills";
import { getSystemMcpServerNames } from "./features/claude-code-mcp-loader";
import {
  setMainSession,
  getMainSessionID,
  setSessionAgent,
  updateSessionAgent,
  clearSessionAgent,
} from "./features/claude-code-session-state";
import {
  builtinTools,
  createCallOmoAgent,
  createBackgroundTools,
  createLookAt,
  createSkillTool,
  createSkillMcpTool,
  createSlashcommandTool,
  discoverCommandsSync,
  sessionExists,
  createDelegateTask,
  interactive_bash,
  startTmuxCheck,
  lspManager,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
  createGrepTools,
  createGlobTools,
  createAstGrepTools,
  createSessionManagerTools,
} from "./tools";
import {
  CATEGORY_DESCRIPTIONS,
  DEFAULT_CATEGORIES,
} from "./tools/delegate-task/constants";
import { BackgroundManager } from "./features/background-agent";
import { SkillMcpManager } from "./features/skill-mcp-manager";
import { initTaskToastManager } from "./features/task-toast-manager";
import { TmuxSessionManager } from "./features/tmux-subagent";
import { clearBoulderState } from "./features/boulder-state";
import { type HookName } from "./config";
import {
  log,
  detectExternalNotificationPlugin,
  getNotificationConflictWarning,
  resetMessageCursor,
  hasConnectedProvidersCache,
  getOpenCodeVersion,
  isOpenCodeVersionAtLeast,
  OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
  injectServerAuthIntoClient,
} from "./shared";
import { filterDisabledTools } from "./shared/disabled-tools";
import { safeCreateHook } from "./shared/safe-create-hook";
import { loadPluginConfig } from "./plugin-config";
import { createModelCacheState } from "./plugin-state";
import { createConfigHandler } from "./plugin-handlers";
import { consumeToolMetadata } from "./features/tool-metadata-store";

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  log("[OhMyOpenCodePlugin] ENTRY - plugin loading", {
    directory: ctx.directory,
  });
  injectServerAuthIntoClient(ctx.client);
  // Start background tmux check immediately
  startTmuxCheck();

  const pluginConfig = loadPluginConfig(ctx.directory, ctx);
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);

  const firstMessageVariantGate = createFirstMessageVariantGate();

  const tmuxConfig = {
    enabled: pluginConfig.tmux?.enabled ?? false,
    layout: pluginConfig.tmux?.layout ?? "main-vertical",
    main_pane_size: pluginConfig.tmux?.main_pane_size ?? 60,
    main_pane_min_width: pluginConfig.tmux?.main_pane_min_width ?? 120,
    agent_pane_min_width: pluginConfig.tmux?.agent_pane_min_width ?? 40,
  } as const;
  const isHookEnabled = (hookName: HookName) => !disabledHooks.has(hookName);
  const safeHookEnabled = pluginConfig.experimental?.safe_hook_creation ?? true;

  const modelCacheState = createModelCacheState();

  const contextWindowMonitor = isHookEnabled("context-window-monitor")
    ? safeCreateHook("context-window-monitor", () => createContextWindowMonitorHook(ctx), { enabled: safeHookEnabled })
    : null;
  const preemptiveCompaction =
    isHookEnabled("preemptive-compaction") &&
    pluginConfig.experimental?.preemptive_compaction
      ? safeCreateHook("preemptive-compaction", () => createPreemptiveCompactionHook(ctx), { enabled: safeHookEnabled })
      : null;
  const sessionRecovery = isHookEnabled("session-recovery")
    ? safeCreateHook("session-recovery", () => createSessionRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
      }), { enabled: safeHookEnabled })
    : null;

  // Check for conflicting notification plugins before creating session-notification
  let sessionNotification = null;
  if (isHookEnabled("session-notification")) {
    const forceEnable = pluginConfig.notification?.force_enable ?? false;
    const externalNotifier = detectExternalNotificationPlugin(ctx.directory);

    if (externalNotifier.detected && !forceEnable) {
      // External notification plugin detected - skip our notification to avoid conflicts
      log(getNotificationConflictWarning(externalNotifier.pluginName!));
      log("session-notification disabled due to external notifier conflict", {
        detected: externalNotifier.pluginName,
        allPlugins: externalNotifier.allPlugins,
      });
    } else {
      sessionNotification = safeCreateHook("session-notification", () => createSessionNotification(ctx), { enabled: safeHookEnabled });
    }
  }

  const commentChecker = isHookEnabled("comment-checker")
    ? safeCreateHook("comment-checker", () => createCommentCheckerHooks(pluginConfig.comment_checker), { enabled: safeHookEnabled })
    : null;
  const toolOutputTruncator = isHookEnabled("tool-output-truncator")
    ? safeCreateHook("tool-output-truncator", () => createToolOutputTruncatorHook(ctx, {
        experimental: pluginConfig.experimental,
      }), { enabled: safeHookEnabled })
    : null;
  // Check for native OpenCode AGENTS.md injection support before creating hook
  let directoryAgentsInjector = null;
  if (isHookEnabled("directory-agents-injector")) {
    const currentVersion = getOpenCodeVersion();
    const hasNativeSupport =
      currentVersion !== null &&
      isOpenCodeVersionAtLeast(OPENCODE_NATIVE_AGENTS_INJECTION_VERSION);

    if (hasNativeSupport) {
      log(
        "directory-agents-injector auto-disabled due to native OpenCode support",
        {
          currentVersion,
          nativeVersion: OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
        },
      );
    } else {
      directoryAgentsInjector = safeCreateHook("directory-agents-injector", () => createDirectoryAgentsInjectorHook(ctx), { enabled: safeHookEnabled });
    }
  }
  const directoryReadmeInjector = isHookEnabled("directory-readme-injector")
    ? safeCreateHook("directory-readme-injector", () => createDirectoryReadmeInjectorHook(ctx), { enabled: safeHookEnabled })
    : null;
  const emptyTaskResponseDetector = isHookEnabled(
    "empty-task-response-detector",
  )
    ? safeCreateHook("empty-task-response-detector", () => createEmptyTaskResponseDetectorHook(ctx), { enabled: safeHookEnabled })
    : null;
  const thinkMode = isHookEnabled("think-mode") ? safeCreateHook("think-mode", () => createThinkModeHook(), { enabled: safeHookEnabled }) : null;
  const claudeCodeHooks = createClaudeCodeHooksHook(
    ctx,
    {
      disabledHooks:
        (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
      keywordDetectorDisabled: !isHookEnabled("keyword-detector"),
    },
    contextCollector,
  );
  const anthropicContextWindowLimitRecovery = isHookEnabled(
    "anthropic-context-window-limit-recovery",
  )
    ? safeCreateHook("anthropic-context-window-limit-recovery", () => createAnthropicContextWindowLimitRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
      }), { enabled: safeHookEnabled })
    : null;
  const rulesInjector = isHookEnabled("rules-injector")
    ? safeCreateHook("rules-injector", () => createRulesInjectorHook(ctx), { enabled: safeHookEnabled })
    : null;
  const autoUpdateChecker = isHookEnabled("auto-update-checker")
    ? safeCreateHook("auto-update-checker", () => createAutoUpdateCheckerHook(ctx, {
        showStartupToast: isHookEnabled("startup-toast"),
        isSisyphusEnabled: pluginConfig.sisyphus_agent?.disabled !== true,
        autoUpdate: pluginConfig.auto_update ?? true,
      }), { enabled: safeHookEnabled })
    : null;
  const keywordDetector = isHookEnabled("keyword-detector")
    ? safeCreateHook("keyword-detector", () => createKeywordDetectorHook(ctx, contextCollector), { enabled: safeHookEnabled })
    : null;
  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector);
  const agentUsageReminder = isHookEnabled("agent-usage-reminder")
    ? safeCreateHook("agent-usage-reminder", () => createAgentUsageReminderHook(ctx), { enabled: safeHookEnabled })
    : null;
  const nonInteractiveEnv = isHookEnabled("non-interactive-env")
    ? safeCreateHook("non-interactive-env", () => createNonInteractiveEnvHook(ctx), { enabled: safeHookEnabled })
    : null;
  const interactiveBashSession = isHookEnabled("interactive-bash-session")
    ? safeCreateHook("interactive-bash-session", () => createInteractiveBashSessionHook(ctx), { enabled: safeHookEnabled })
    : null;

  const thinkingBlockValidator = isHookEnabled("thinking-block-validator")
    ? safeCreateHook("thinking-block-validator", () => createThinkingBlockValidatorHook(), { enabled: safeHookEnabled })
    : null;

  let categorySkillReminder: ReturnType<typeof createCategorySkillReminderHook> | null = null;

  const ralphLoop = isHookEnabled("ralph-loop")
    ? safeCreateHook("ralph-loop", () => createRalphLoopHook(ctx, {
        config: pluginConfig.ralph_loop,
        checkSessionExists: async (sessionId) => sessionExists(sessionId),
      }), { enabled: safeHookEnabled })
    : null;

  const editErrorRecovery = isHookEnabled("edit-error-recovery")
    ? safeCreateHook("edit-error-recovery", () => createEditErrorRecoveryHook(ctx), { enabled: safeHookEnabled })
    : null;

  const delegateTaskRetry = isHookEnabled("delegate-task-retry")
    ? safeCreateHook("delegate-task-retry", () => createDelegateTaskRetryHook(ctx), { enabled: safeHookEnabled })
    : null;

  const startWork = isHookEnabled("start-work")
    ? safeCreateHook("start-work", () => createStartWorkHook(ctx), { enabled: safeHookEnabled })
    : null;

  const prometheusMdOnly = isHookEnabled("prometheus-md-only")
    ? safeCreateHook("prometheus-md-only", () => createPrometheusMdOnlyHook(ctx), { enabled: safeHookEnabled })
    : null;

  const sisyphusJuniorNotepad = isHookEnabled("sisyphus-junior-notepad")
    ? safeCreateHook("sisyphus-junior-notepad", () => createSisyphusJuniorNotepadHook(ctx), { enabled: safeHookEnabled })
    : null;

  const tasksTodowriteDisabler = isHookEnabled("tasks-todowrite-disabler")
    ? safeCreateHook("tasks-todowrite-disabler", () => createTasksTodowriteDisablerHook({
        experimental: pluginConfig.experimental,
      }), { enabled: safeHookEnabled })
    : null;

  const questionLabelTruncator = createQuestionLabelTruncatorHook();
  const subagentQuestionBlocker = createSubagentQuestionBlockerHook();
  const writeExistingFileGuard = isHookEnabled("write-existing-file-guard")
    ? safeCreateHook("write-existing-file-guard", () => createWriteExistingFileGuardHook(ctx), { enabled: safeHookEnabled })
    : null;

  const taskResumeInfo = createTaskResumeInfoHook();

  const anthropicEffort = isHookEnabled("anthropic-effort")
    ? safeCreateHook("anthropic-effort", () => createAnthropicEffortHook(), { enabled: safeHookEnabled })
    : null;

  const tmuxSessionManager = new TmuxSessionManager(ctx, tmuxConfig);

  const backgroundManager = new BackgroundManager(
    ctx,
    pluginConfig.background_task,
    {
      tmuxConfig,
      onSubagentSessionCreated: async (event) => {
        log("[index] onSubagentSessionCreated callback received", {
          sessionID: event.sessionID,
          parentID: event.parentID,
          title: event.title,
        });
        await tmuxSessionManager.onSessionCreated({
          type: "session.created",
          properties: {
            info: {
              id: event.sessionID,
              parentID: event.parentID,
              title: event.title,
            },
          },
        });
        log("[index] onSubagentSessionCreated callback completed");
      },
      onShutdown: () => {
        tmuxSessionManager.cleanup().catch((error) => {
          log("[index] tmux cleanup error during shutdown:", error);
        });
      },
    },
  );

  const atlasHook = isHookEnabled("atlas")
    ? safeCreateHook("atlas", () => createAtlasHook(ctx, { 
        directory: ctx.directory, 
        backgroundManager,
        isContinuationStopped: (sessionID: string) => stopContinuationGuard?.isStopped(sessionID) ?? false,
      }), { enabled: safeHookEnabled })
    : null;

  initTaskToastManager(ctx.client);

  const stopContinuationGuard = isHookEnabled("stop-continuation-guard")
    ? safeCreateHook("stop-continuation-guard", () => createStopContinuationGuardHook(ctx), { enabled: safeHookEnabled })
    : null;

  const compactionContextInjector = isHookEnabled("compaction-context-injector")
    ? safeCreateHook("compaction-context-injector", () => createCompactionContextInjector(), { enabled: safeHookEnabled })
    : null;

  const compactionTodoPreserver = isHookEnabled("compaction-todo-preserver")
    ? safeCreateHook("compaction-todo-preserver", () => createCompactionTodoPreserverHook(ctx), { enabled: safeHookEnabled })
    : null;

  const todoContinuationEnforcer = isHookEnabled("todo-continuation-enforcer")
    ? safeCreateHook("todo-continuation-enforcer", () => createTodoContinuationEnforcer(ctx, {
        backgroundManager,
        isContinuationStopped: stopContinuationGuard?.isStopped,
      }), { enabled: safeHookEnabled })
    : null;

  const unstableAgentBabysitter = isHookEnabled("unstable-agent-babysitter")
    ? safeCreateHook("unstable-agent-babysitter", () => createUnstableAgentBabysitterHook(
        {
          directory: ctx.directory,
          client: {
            session: {
              messages: async (args) => {
                const result = await ctx.client.session.messages(args);
                if (Array.isArray(result)) return result;
                if (
                  typeof result === "object" &&
                  result !== null &&
                  "data" in result
                ) {
                  const record = result as Record<string, unknown>;
                  return { data: record.data };
                }
                return [];
              },
               prompt: async (args) => {
                 await ctx.client.session.promptAsync(args);
               },
               promptAsync: async (args) => {
                 await ctx.client.session.promptAsync(args);
               },
             },
          },
        },
        {
          backgroundManager,
          config: pluginConfig.babysitting,
        },
      ), { enabled: safeHookEnabled })
    : null;

  if (sessionRecovery && todoContinuationEnforcer) {
    sessionRecovery.setOnAbortCallback(todoContinuationEnforcer.markRecovering);
    sessionRecovery.setOnRecoveryCompleteCallback(
      todoContinuationEnforcer.markRecoveryComplete,
    );
  }

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? safeCreateHook("background-notification", () => createBackgroundNotificationHook(backgroundManager), { enabled: safeHookEnabled })
    : null;
  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const callOmoAgent = createCallOmoAgent(ctx, backgroundManager);
  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  );
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null;
  const browserProvider =
    pluginConfig.browser_automation_engine?.provider ?? "playwright";
  const disabledSkills = new Set<string>(pluginConfig.disabled_skills ?? []);
  const systemMcpNames = getSystemMcpServerNames();
  const builtinSkills = createBuiltinSkills({ browserProvider, disabledSkills }).filter((skill) => {
      if (skill.mcpConfig) {
        for (const mcpName of Object.keys(skill.mcpConfig)) {
          if (systemMcpNames.has(mcpName)) return false;
        }
      }
      return true;
    },
  );
  const includeClaudeSkills = pluginConfig.claude_code?.skills !== false;
  const [userSkills, globalSkills, projectSkills, opencodeProjectSkills] =
    await Promise.all([
      includeClaudeSkills ? discoverUserClaudeSkills() : Promise.resolve([]),
      discoverOpencodeGlobalSkills(),
      includeClaudeSkills ? discoverProjectClaudeSkills() : Promise.resolve([]),
      discoverOpencodeProjectSkills(),
    ]);
  const mergedSkills = mergeSkills(
    builtinSkills,
    pluginConfig.skills,
    userSkills,
    globalSkills,
    projectSkills,
    opencodeProjectSkills,
  );

  function mapScopeToLocation(scope: SkillScope): AvailableSkill["location"] {
    if (scope === "user" || scope === "opencode") return "user";
    if (scope === "project" || scope === "opencode-project") return "project";
    return "plugin";
  }

  const availableSkills: AvailableSkill[] = mergedSkills.map((skill) => ({
    name: skill.name,
    description: skill.definition.description ?? "",
    location: mapScopeToLocation(skill.scope),
  }));

  const mergedCategories = pluginConfig.categories
    ? { ...DEFAULT_CATEGORIES, ...pluginConfig.categories }
    : DEFAULT_CATEGORIES;

  const availableCategories = Object.entries(mergedCategories).map(
    ([name, categoryConfig]) => ({
      name,
      description:
        pluginConfig.categories?.[name]?.description
          ?? CATEGORY_DESCRIPTIONS[name]
          ?? "General tasks",
      model: categoryConfig.model,
    }),
  );

  const delegateTask = createDelegateTask({
    manager: backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: pluginConfig.agents?.["sisyphus-junior"]?.model,
    browserProvider,
    disabledSkills,
    availableCategories,
    availableSkills,
    agentOverrides: pluginConfig.agents,
    onSyncSessionCreated: async (event) => {
      log("[index] onSyncSessionCreated callback", {
        sessionID: event.sessionID,
        parentID: event.parentID,
        title: event.title,
      });
      await tmuxSessionManager.onSessionCreated({
        type: "session.created",
        properties: {
          info: {
            id: event.sessionID,
            parentID: event.parentID,
            title: event.title,
          },
        },
      });
    },
  });

  categorySkillReminder = isHookEnabled("category-skill-reminder")
    ? safeCreateHook("category-skill-reminder", () => createCategorySkillReminderHook(ctx, availableSkills), { enabled: safeHookEnabled })
    : null;

  const skillMcpManager = new SkillMcpManager();
  const getSessionIDForMcp = () => getMainSessionID() || "";
  const skillTool = createSkillTool({
    skills: mergedSkills,
    mcpManager: skillMcpManager,
    getSessionID: getSessionIDForMcp,
    gitMasterConfig: pluginConfig.git_master,
    disabledSkills
  });
  const skillMcpTool = createSkillMcpTool({
    manager: skillMcpManager,
    getLoadedSkills: () => mergedSkills,
    getSessionID: getSessionIDForMcp,
  });

  const commands = discoverCommandsSync();
  const slashcommandTool = createSlashcommandTool({
    commands,
    skills: mergedSkills,
  });

  const autoSlashCommand = isHookEnabled("auto-slash-command")
    ? safeCreateHook("auto-slash-command", () => createAutoSlashCommandHook({ skills: mergedSkills }), { enabled: safeHookEnabled })
    : null;

  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
    modelCacheState,
  });

  const taskSystemEnabled = pluginConfig.experimental?.task_system ?? false;
  const taskToolsRecord: Record<string, ToolDefinition> = taskSystemEnabled
    ? {
        task_create: createTaskCreateTool(pluginConfig, ctx),
        task_get: createTaskGetTool(pluginConfig),
        task_list: createTaskList(pluginConfig),
        task_update: createTaskUpdateTool(pluginConfig, ctx),
      }
    : {};

  const allTools: Record<string, ToolDefinition> = {
    ...builtinTools,
    ...createGrepTools(ctx),
    ...createGlobTools(ctx),
    ...createAstGrepTools(ctx),
    ...createSessionManagerTools(ctx),
    ...backgroundTools,
    call_omo_agent: callOmoAgent,
    ...(lookAt ? { look_at: lookAt } : {}),
      task: delegateTask,
    skill: skillTool,
    skill_mcp: skillMcpTool,
    slashcommand: slashcommandTool,
    interactive_bash,
    ...taskToolsRecord,
  };

  const filteredTools: Record<string, ToolDefinition> = filterDisabledTools(
    allTools,
    pluginConfig.disabled_tools,
  );

  return {
    tool: filteredTools,

    "chat.params": async (
      input: {
        sessionID: string
        agent: string
        model: Record<string, unknown>
        provider: Record<string, unknown>
        message: Record<string, unknown>
      },
      output: {
        temperature: number
        topP: number
        topK: number
        options: Record<string, unknown>
      },
    ) => {
      const model = input.model as { providerID: string; modelID: string }
      const message = input.message as { variant?: string }
      await anthropicEffort?.["chat.params"]?.(
        { ...input, agent: { name: input.agent }, model, provider: input.provider as { id: string }, message },
        output,
      );
    },

    "chat.message": async (input, output) => {
      if (input.agent) {
        setSessionAgent(input.sessionID, input.agent);
      }

      const message = (output as { message: { variant?: string } }).message;
      if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
        const variant =
          input.model && input.agent
            ? resolveVariantForModel(pluginConfig, input.agent, input.model)
            : resolveAgentVariant(pluginConfig, input.agent);
        if (variant !== undefined) {
          message.variant = variant;
        }
        firstMessageVariantGate.markApplied(input.sessionID);
      } else {
        if (input.model && input.agent && message.variant === undefined) {
          const variant = resolveVariantForModel(
            pluginConfig,
            input.agent,
            input.model,
          );
          if (variant !== undefined) {
            message.variant = variant;
          }
        } else {
          applyAgentVariant(pluginConfig, input.agent, message);
        }
      }

      await stopContinuationGuard?.["chat.message"]?.(input);
      await keywordDetector?.["chat.message"]?.(input, output);
      await claudeCodeHooks?.["chat.message"]?.(input, output);
      await autoSlashCommand?.["chat.message"]?.(input, output);
      await startWork?.["chat.message"]?.(input, output);

      if (!hasConnectedProvidersCache()) {
        ctx.client.tui
          .showToast({
            body: {
              title: "⚠️ Provider Cache Missing",
              message:
                "Model filtering disabled. RESTART OpenCode to enable full functionality.",
              variant: "warning" as const,
              duration: 6000,
            },
          })
          .catch(() => {});
      }

      if (ralphLoop) {
        const parts = (
          output as { parts?: Array<{ type: string; text?: string }> }
        ).parts;
        const promptText =
          parts
            ?.filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("\n")
            .trim() || "";

        const isRalphLoopTemplate =
          promptText.includes("You are starting a Ralph Loop") &&
          promptText.includes("<user-task>");
        const isCancelRalphTemplate = promptText.includes(
          "Cancel the currently active Ralph Loop",
        );

        if (isRalphLoopTemplate) {
          const taskMatch = promptText.match(
            /<user-task>\s*([\s\S]*?)\s*<\/user-task>/i,
          );
          const rawTask = taskMatch?.[1]?.trim() || "";

          const quotedMatch = rawTask.match(/^["'](.+?)["']/);
          const prompt =
            quotedMatch?.[1] ||
            rawTask.split(/\s+--/)[0]?.trim() ||
            "Complete the task as instructed";

          const maxIterMatch = rawTask.match(/--max-iterations=(\d+)/i);
          const promiseMatch = rawTask.match(
            /--completion-promise=["']?([^"'\s]+)["']?/i,
          );

          log("[ralph-loop] Starting loop from chat.message", {
            sessionID: input.sessionID,
            prompt,
          });
          ralphLoop.startLoop(input.sessionID, prompt, {
            maxIterations: maxIterMatch
              ? parseInt(maxIterMatch[1], 10)
              : undefined,
            completionPromise: promiseMatch?.[1],
          });
        } else if (isCancelRalphTemplate) {
          log("[ralph-loop] Cancelling loop from chat.message", {
            sessionID: input.sessionID,
          });
          ralphLoop.cancelLoop(input.sessionID);
        }
      }
    },

    "experimental.chat.messages.transform": async (
      input: Record<string, never>,
      output: { messages: Array<{ info: unknown; parts: unknown[] }> },
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await contextInjectorMessagesTransform?.[
        "experimental.chat.messages.transform"
      ]?.(input, output as any);
      await thinkingBlockValidator?.[
        "experimental.chat.messages.transform"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]?.(input, output as any);
    },

    config: configHandler,

    event: async (input) => {
      await autoUpdateChecker?.event(input);
      await claudeCodeHooks?.event?.(input);
      await backgroundNotificationHook?.event(input);
      await sessionNotification?.(input);
      await todoContinuationEnforcer?.handler(input);
      await unstableAgentBabysitter?.event(input);
      await contextWindowMonitor?.event(input);
      await directoryAgentsInjector?.event(input);
      await directoryReadmeInjector?.event(input);
      await rulesInjector?.event(input);
      await thinkMode?.event(input);
      await anthropicContextWindowLimitRecovery?.event(input);
      await agentUsageReminder?.event(input);
      await categorySkillReminder?.event(input);
      await interactiveBashSession?.event(input);
      await ralphLoop?.event(input);
      await stopContinuationGuard?.event(input);
      await compactionTodoPreserver?.event(input);
      await atlasHook?.handler(input);

      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.created") {
        const sessionInfo = props?.info as
          | { id?: string; title?: string; parentID?: string }
          | undefined;
        log("[event] session.created", { sessionInfo, props });
        if (!sessionInfo?.parentID) {
          setMainSession(sessionInfo?.id);
        }
        firstMessageVariantGate.markSessionCreated(sessionInfo);
        await tmuxSessionManager.onSessionCreated(
          event as {
            type: string;
            properties?: {
              info?: { id?: string; parentID?: string; title?: string };
            };
          },
        );
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id === getMainSessionID()) {
          setMainSession(undefined);
        }
        if (sessionInfo?.id) {
          clearSessionAgent(sessionInfo.id);
          resetMessageCursor(sessionInfo.id);
          firstMessageVariantGate.clear(sessionInfo.id);
          await skillMcpManager.disconnectSession(sessionInfo.id);
          await lspManager.cleanupTempDirectoryClients();
          await tmuxSessionManager.onSessionDeleted({
            sessionID: sessionInfo.id,
          });
        }
      }

      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined;
        const sessionID = info?.sessionID as string | undefined;
        const agent = info?.agent as string | undefined;
        const role = info?.role as string | undefined;
        if (sessionID && agent && role === "user") {
          updateSessionAgent(sessionID, agent);
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

          if (
            recovered &&
            sessionID &&
            sessionID === getMainSessionID() &&
            !stopContinuationGuard?.isStopped(sessionID)
          ) {
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
      await subagentQuestionBlocker?.["tool.execute.before"]?.(input, output);
      await writeExistingFileGuard?.["tool.execute.before"]?.(input, output);
      await questionLabelTruncator?.["tool.execute.before"]?.(input, output);
      await claudeCodeHooks?.["tool.execute.before"]?.(input, output);
      await nonInteractiveEnv?.["tool.execute.before"](input, output);
      await commentChecker?.["tool.execute.before"]?.(input, output);
      await directoryAgentsInjector?.["tool.execute.before"]?.(input, output);
      await directoryReadmeInjector?.["tool.execute.before"]?.(input, output);
      await rulesInjector?.["tool.execute.before"]?.(input, output);
      await tasksTodowriteDisabler?.["tool.execute.before"]?.(input, output);
      await prometheusMdOnly?.["tool.execute.before"]?.(input, output);
      await sisyphusJuniorNotepad?.["tool.execute.before"]?.(input, output);
      await atlasHook?.["tool.execute.before"]?.(input, output);

      if (input.tool === "task") {
        const args = output.args as Record<string, unknown>;
        const category = typeof args.category === "string" ? args.category : undefined;
        const subagentType = typeof args.subagent_type === "string" ? args.subagent_type : undefined;
        if (category && !subagentType) {
          args.subagent_type = "sisyphus-junior";
        }
      }

      if (ralphLoop && input.tool === "slashcommand") {
        const args = output.args as { command?: string } | undefined;
        const command = args?.command?.replace(/^\//, "").toLowerCase();
        const sessionID = input.sessionID || getMainSessionID();

        if (command === "ralph-loop" && sessionID) {
          const rawArgs =
            args?.command?.replace(/^\/?(ralph-loop)\s*/i, "") || "";
          const taskMatch = rawArgs.match(/^["'](.+?)["']/);
          const prompt =
            taskMatch?.[1] ||
            rawArgs.split(/\s+--/)[0]?.trim() ||
            "Complete the task as instructed";

          const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i);
          const promiseMatch = rawArgs.match(
            /--completion-promise=["']?([^"'\s]+)["']?/i,
          );

          ralphLoop.startLoop(sessionID, prompt, {
            maxIterations: maxIterMatch
              ? parseInt(maxIterMatch[1], 10)
              : undefined,
            completionPromise: promiseMatch?.[1],
          });
        } else if (command === "cancel-ralph" && sessionID) {
          ralphLoop.cancelLoop(sessionID);
        } else if (command === "ulw-loop" && sessionID) {
          const rawArgs =
            args?.command?.replace(/^\/?(ulw-loop)\s*/i, "") || "";
          const taskMatch = rawArgs.match(/^["'](.+?)["']/);
          const prompt =
            taskMatch?.[1] ||
            rawArgs.split(/\s+--/)[0]?.trim() ||
            "Complete the task as instructed";

          const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i);
          const promiseMatch = rawArgs.match(
            /--completion-promise=["']?([^"'\s]+)["']?/i,
          );

          ralphLoop.startLoop(sessionID, prompt, {
            ultrawork: true,
            maxIterations: maxIterMatch
              ? parseInt(maxIterMatch[1], 10)
              : undefined,
            completionPromise: promiseMatch?.[1],
          });
        }
      }

      if (input.tool === "slashcommand") {
        const args = output.args as { command?: string } | undefined;
        const command = args?.command?.replace(/^\//, "").toLowerCase();
        const sessionID = input.sessionID || getMainSessionID();

        if (command === "stop-continuation" && sessionID) {
          stopContinuationGuard?.stop(sessionID);
          todoContinuationEnforcer?.cancelAllCountdowns();
          ralphLoop?.cancelLoop(sessionID);
          clearBoulderState(ctx.directory);
          log("[stop-continuation] All continuation mechanisms stopped", {
            sessionID,
          });
        }
      }
    },

    "tool.execute.after": async (input, output) => {
      // Guard against undefined output (e.g., from /review command - see issue #1035)
      if (!output) {
        return;
      }

      // Restore metadata that fromPlugin() overwrites with { truncated, outputPath }.
      // This must run FIRST, before any hook reads output.metadata.
      const stored = consumeToolMetadata(input.sessionID, input.callID)
      if (stored) {
        if (stored.title) {
          output.title = stored.title
        }
        if (stored.metadata) {
          output.metadata = { ...output.metadata, ...stored.metadata }
        }
      }

      await claudeCodeHooks?.["tool.execute.after"]?.(input, output);
      await toolOutputTruncator?.["tool.execute.after"](input, output);
      await preemptiveCompaction?.["tool.execute.after"](input, output);
      await contextWindowMonitor?.["tool.execute.after"](input, output);
      await commentChecker?.["tool.execute.after"](input, output);
      await directoryAgentsInjector?.["tool.execute.after"](input, output);
      await directoryReadmeInjector?.["tool.execute.after"](input, output);
      await rulesInjector?.["tool.execute.after"](input, output);
      await emptyTaskResponseDetector?.["tool.execute.after"](input, output);
      await agentUsageReminder?.["tool.execute.after"](input, output);
      await categorySkillReminder?.["tool.execute.after"](input, output);
      await interactiveBashSession?.["tool.execute.after"](input, output);
      await editErrorRecovery?.["tool.execute.after"](input, output);
      await delegateTaskRetry?.["tool.execute.after"](input, output);
      await atlasHook?.["tool.execute.after"]?.(input, output);
      await taskResumeInfo?.["tool.execute.after"]?.(input, output);
    },

    "experimental.session.compacting": async (
      _input: { sessionID: string },
      output: { context: string[] },
    ): Promise<void> => {
      await compactionTodoPreserver?.capture(_input.sessionID);
      if (!compactionContextInjector) {
        return;
      }
      output.context.push(compactionContextInjector());
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
