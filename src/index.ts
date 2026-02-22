import type { Plugin, ToolDefinition, PluginInput } from "@opencode-ai/plugin";
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
  createSkillAutoTriggerHook,
  createAgentUsageReminderHook,
  createAgentSkillReminderHook,
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
  createNotepadWriteGuardHook,
  createQuestionLabelTruncatorHook,
  // TDD Guard hook
  createTddGuardHook,
  createPlanningFlowGuideHook,
  createPlanReorganizerHook,
  createPlanUpdateReminderHook,
  createPlanAttentionRefresherHook,
  // Phase 2: High-priority hooks
  createSubagentVerificationHook,
  // Note: createBackgroundCompactionHook not yet implemented
  // Phase 3: Optional hooks
  createCodebaseAssessmentHook,
  createLspDiagnosticsEnforcerHook,
  createPhaseFlowEnforcerHook,
  // mdsel reminder hook
  createMdselReminderHook,
  createObservationRecorderHook,
  createObserverDetectorHook,
  createInstinctTriggerHook,
  createInstinctLearnerHook,
  createPatternExtractionHook,
  createObservationWriteGuardHook,
  createSecretScannerHook,
  createSkillAutoInjectorHook,
  createBehaviorAnchorHook,
  createVerbosityControllerHook,
  createPhaseRulesInjectorHook,
  createKnowledgeInjectionHook,
  createProjectContextInjectorHook,
  createPrContextInjectorHook,
  // Upstream hooks
  createSubagentQuestionBlockerHook,
  createStopContinuationGuardHook,
  createCompactionContextInjector,
  createUnstableAgentBabysitterHook,
  createPreemptiveCompactionHook,
  createTasksTodowriteDisablerHook,
  createWriteExistingFileGuardHook,
  createTasksMdCreationGuardHook,
  createCommitSizeChecker,
  createFinalAuditHook,
} from "./hooks";
import { createSessionScorer } from "./features/session-scorer";
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
} from "./tools";
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
  createContextDetector,
} from "./shared";
import { loadPluginConfig } from "./plugin-config";
import { createModelCacheState } from "./plugin-state";
import { createConfigHandler } from "./plugin-handlers";
import { createHookExecutor } from "./shared/hook-executor";

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  log("[OhMyOpenCodePlugin] ENTRY - plugin loading", {
    directory: ctx.directory,
  });
  injectServerAuthIntoClient(ctx.client);
  // Start background tmux check immediately
  startTmuxCheck();

  const pluginConfig = loadPluginConfig(ctx.directory, ctx);
  const detector = createContextDetector();
  const projectContext = detector.detect(ctx.directory);
  const disabledHooks = new Set<HookName>();
  
  if (pluginConfig.disabled_hooks) {
    for (const hookConfig of pluginConfig.disabled_hooks) {
      if (typeof hookConfig === "string") {
        disabledHooks.add(hookConfig);
      } else {
        const name = hookConfig.name;
        const condition = hookConfig.when;
        if (!condition || detector.matchesCondition(projectContext, condition)) {
          disabledHooks.add(name);
        }
      }
    }
  }
  const firstMessageVariantGate = createFirstMessageVariantGate();

  const tmuxConfig = {
    enabled: pluginConfig.tmux?.enabled ?? false,
    layout: pluginConfig.tmux?.layout ?? "main-vertical",
    main_pane_size: pluginConfig.tmux?.main_pane_size ?? 60,
    main_pane_min_width: pluginConfig.tmux?.main_pane_min_width ?? 120,
    agent_pane_min_width: pluginConfig.tmux?.agent_pane_min_width ?? 40,
  } as const;
  const isHookEnabled = (hookName: HookName) => !disabledHooks.has(hookName);

  const modelCacheState = createModelCacheState();

  const contextWindowMonitor = isHookEnabled("context-window-monitor")
    ? createContextWindowMonitorHook(ctx)
    : null;
  const preemptiveCompaction =
    isHookEnabled("preemptive-compaction") &&
    pluginConfig.experimental?.preemptive_compaction
      ? createPreemptiveCompactionHook(ctx)
      : null;
  const sessionRecovery = isHookEnabled("session-recovery")
    ? createSessionRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
      })
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
      sessionNotification = createSessionNotification(ctx);
    }
  }

  const commentChecker = isHookEnabled("comment-checker")
    ? createCommentCheckerHooks(pluginConfig.comment_checker)
    : null;
  const toolOutputTruncator = isHookEnabled("tool-output-truncator")
    ? createToolOutputTruncatorHook(ctx, {
        experimental: pluginConfig.experimental,
      })
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
      directoryAgentsInjector = createDirectoryAgentsInjectorHook(ctx);
    }
  }
  const directoryReadmeInjector = isHookEnabled("directory-readme-injector")
    ? createDirectoryReadmeInjectorHook(ctx)
    : null;
  const emptyTaskResponseDetector = isHookEnabled(
    "empty-task-response-detector",
  )
    ? createEmptyTaskResponseDetectorHook(ctx)
    : null;
  const thinkMode = isHookEnabled("think-mode") ? createThinkModeHook() : null;
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
    ? createAnthropicContextWindowLimitRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
      })
    : null;
  const compactionContextInjector = isHookEnabled("compaction-context-injector")
    ? createCompactionContextInjector()
    : undefined;
  
  // Create a mutable reference for todoContinuationEnforcer callbacks
  // This allows preemptiveCompaction to call these even though it's created first
  const todoContinuationCallbacks: {
    markRecovering?: (sessionID: string) => void;
    markRecoveryComplete?: (sessionID: string) => void;
  } = {};

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
    ? createKeywordDetectorHook(ctx, contextCollector)
    : null;
  const skillAutoTrigger = isHookEnabled("skill-auto-trigger" as HookName)
    ? (
        createSkillAutoTriggerHook as (
          ctx: PluginInput,
          collector: typeof contextCollector,
        ) => ReturnType<typeof createSkillAutoTriggerHook>
      )(ctx, contextCollector)
    : null;
  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector);
  const agentUsageReminder = isHookEnabled("agent-usage-reminder")
    ? createAgentUsageReminderHook(ctx)
    : null;
  const agentSkillReminder = isHookEnabled("agent-skill-reminder")
    ? createAgentSkillReminderHook(ctx, contextCollector)
    : null;
  const nonInteractiveEnv = isHookEnabled("non-interactive-env")
    ? createNonInteractiveEnvHook(ctx)
    : null;
  const interactiveBashSession = isHookEnabled("interactive-bash-session")
    ? createInteractiveBashSessionHook(ctx)
    : null;

  const thinkingBlockValidator = isHookEnabled("thinking-block-validator")
    ? createThinkingBlockValidatorHook()
    : null;

  const categorySkillReminder = isHookEnabled("category-skill-reminder")
    ? createCategorySkillReminderHook(ctx)
    : null;

  const ralphLoop = isHookEnabled("ralph-loop")
    ? createRalphLoopHook(ctx, {
        config: pluginConfig.ralph_loop,
        checkSessionExists: async (sessionId) => sessionExists(sessionId),
      })
    : null;

  const editErrorRecovery = isHookEnabled("edit-error-recovery")
    ? createEditErrorRecoveryHook(ctx)
    : null;

  const delegateTaskRetry = isHookEnabled("delegate-task-retry")
    ? createDelegateTaskRetryHook(ctx)
    : null;

  const startWork = isHookEnabled("start-work")
    ? createStartWorkHook(ctx)
    : null;

  const prometheusMdOnly = isHookEnabled("prometheus-md-only")
    ? createPrometheusMdOnlyHook(ctx)
    : null;

  const sisyphusJuniorNotepad = isHookEnabled("sisyphus-junior-notepad")
    ? createSisyphusJuniorNotepadHook(ctx)
    : null;

  const notepadWriteGuard = isHookEnabled("notepad-write-guard")
    ? createNotepadWriteGuardHook(ctx)
    : null;

  const observationWriteGuard = isHookEnabled("observation-write-guard")
    ? createObservationWriteGuardHook(ctx)
    : null;

  // Note: tasksTodowriteDisabler imported but NOT registered to keep TodoWrite available

  const questionLabelTruncator = createQuestionLabelTruncatorHook();
  const subagentQuestionBlocker = createSubagentQuestionBlockerHook();
  const writeExistingFileGuard = isHookEnabled("write-existing-file-guard")
    ? createWriteExistingFileGuardHook(ctx)
    : null;

  const tasksMdCreationGuard = isHookEnabled("tasks-md-creation-guard")
    ? createTasksMdCreationGuardHook(ctx)
    : null;

  const sessionScorer = isHookEnabled("session-scorer")
    ? createSessionScorer()
    : null;

  const finalAudit = createFinalAuditHook();

  const commitSizeChecker = isHookEnabled("commit-size-checker")
    ? createCommitSizeChecker()
    : null;

  // TDD Guard hook - enforces Test-Driven Development
  const tddGuard = isHookEnabled("tdd-guard")
    ? createTddGuardHook({ cwd: ctx.directory }, { config: pluginConfig.tdd_guard })
    : null;

  const planningFlowGuide = isHookEnabled("planning-flow-guide")
    ? createPlanningFlowGuideHook(ctx)
    : null;

  const planReorganizer = isHookEnabled("plan-reorganizer")
    ? createPlanReorganizerHook(ctx)
    : null;

  const planUpdateReminder = isHookEnabled("plan-update-reminder")
    ? createPlanUpdateReminderHook(ctx)
    : null;

  const planAttentionRefresher = isHookEnabled("plan-attention-refresher")
    ? createPlanAttentionRefresherHook(ctx)
    : null;

  // Phase 2: High-priority hooks
  // Subagent Verification hook - reminds orchestrator to verify delegated work
  const subagentVerification = isHookEnabled("subagent-verification")
    ? createSubagentVerificationHook(ctx)
    : null;

  // Phase 3: Optional hooks (disabled by default via config)
  // Codebase Assessment hook - evaluates project state at session start
  const codebaseAssessment = isHookEnabled("codebase-assessment")
    ? createCodebaseAssessmentHook(ctx)
    : null;

  // LSP Diagnostics Enforcer hook - ensures diagnostics run before task completion
  const lspDiagnosticsEnforcer = isHookEnabled("lsp-diagnostics-enforcer")
    ? createLspDiagnosticsEnforcerHook(ctx)
    : null;

  // Phase Flow Enforcer hook - warns when boulder phase transitions are skipped
  const phaseFlowEnforcer = isHookEnabled("phase-flow-enforcer")
    ? createPhaseFlowEnforcerHook(ctx)
    : null;

  // mdsel Reminder hook - reminds to use mdsel for large markdown files
  const mdselReminder = isHookEnabled("mdsel-reminder")
    ? createMdselReminderHook(ctx)
    : null;

  const observationRecorder = isHookEnabled("observation-recorder")
    ? createObservationRecorderHook()
    : null;

  const instinctTrigger = isHookEnabled("instinct-trigger")
    ? createInstinctTriggerHook({ claudeConfigDir: (ctx as any).claudeConfigDir })
    : null;

  const instinctLearner = isHookEnabled("instinct-learner")
    ? createInstinctLearnerHook()
    : null;

  const patternExtraction = isHookEnabled("pattern-extraction")
    ? createPatternExtractionHook()
    : null;

  const secretScanner = isHookEnabled("secret-scanner")
    ? createSecretScannerHook({ cwd: ctx.directory })
    : null;

  const skillAutoInjector = isHookEnabled("skill-auto-injector")
    ? createSkillAutoInjectorHook({ cwd: ctx.directory })
    : null;

  const behaviorAnchor = isHookEnabled("behavior-anchor")
    ? createBehaviorAnchorHook()
    : null;

  const verbosityController = isHookEnabled("verbosity-controller")
    ? createVerbosityControllerHook()
    : null;

  const phaseRulesInjector = isHookEnabled("phase-rules-injector")
    ? createPhaseRulesInjectorHook()
    : null;

  const knowledgeInjection = isHookEnabled("knowledge-injection")
    ? createKnowledgeInjectionHook()
    : null;

  const projectContextInjector = isHookEnabled("project-context-injector")
    ? createProjectContextInjectorHook({ directory: ctx.directory, client: ctx.client })
    : null;

  const prContextInjector = isHookEnabled("pr-context-injector")
    ? createPrContextInjectorHook({ directory: ctx.directory })
    : null;

  const taskResumeInfo = createTaskResumeInfoHook();

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
    ? createAtlasHook(ctx, { directory: ctx.directory, backgroundManager })
    : null;

  initTaskToastManager(ctx.client);

  const stopContinuationGuard = isHookEnabled("stop-continuation-guard")
    ? createStopContinuationGuardHook(ctx)
    : null;

  const todoContinuationEnforcer = isHookEnabled("todo-continuation-enforcer")
    ? createTodoContinuationEnforcer(ctx, {
        backgroundManager,
        isContinuationStopped: stopContinuationGuard?.isStopped,
      })
    : null;

  const unstableAgentBabysitter = isHookEnabled("unstable-agent-babysitter")
    ? createUnstableAgentBabysitterHook(
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
                await ctx.client.session.prompt(args);
              },
            },
          },
        },
        {
          backgroundManager,
          config: pluginConfig.babysitting,
        },
      )
    : null;

  if (sessionRecovery && todoContinuationEnforcer) {
    sessionRecovery.setOnAbortCallback(todoContinuationEnforcer.markRecovering);
    sessionRecovery.setOnRecoveryCompleteCallback(
      todoContinuationEnforcer.markRecoveryComplete,
    );
  }

  // Bind todoContinuationEnforcer callbacks for preemptiveCompaction
  // This completes the late binding setup from earlier
  if (todoContinuationEnforcer) {
    todoContinuationCallbacks.markRecovering = todoContinuationEnforcer.markRecovering;
    todoContinuationCallbacks.markRecoveryComplete = todoContinuationEnforcer.markRecoveryComplete;
  }

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? createBackgroundNotificationHook(backgroundManager)
    : null;
  
  // Background Compaction hook - not yet implemented
  const backgroundCompaction = null;

  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const callOmoAgent = createCallOmoAgent(ctx, backgroundManager);
  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  );
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null;
  const browserProvider =
    pluginConfig.browser_automation_engine?.provider ?? "playwright";
  const disabledSkills = new Set<string>(pluginConfig.disabled_skills ?? []);

  const observerDetector = isHookEnabled("observer-detector")
    ? createObserverDetectorHook({
        delegateTask: async (args) => {
          // Use backgroundManager to launch a detached task
          // This prevents polluting the main session with observer prompts
          const task = await backgroundManager.launch({
            description: "Observer Analysis",
            prompt: args.prompt,
            agent: args.subagent_type || "sisyphus-junior",
            skills: [],
            parentSessionID: getMainSessionID() || "global",
            parentMessageID: "hook:observer-detector",
          });
          return task;
        },
      })
    : null;

  const delegateTask = createDelegateTask({
    manager: backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: pluginConfig.agents?.["sisyphus-junior"]?.model,
    browserProvider,
    disabledSkills,
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
  const systemMcpNames = getSystemMcpServerNames();
  const builtinSkills = createBuiltinSkills({ browserProvider, disabledSkills }).filter((skill) => {
    if (skill.mcpConfig) {
      for (const mcpName of Object.keys(skill.mcpConfig)) {
        if (systemMcpNames.has(mcpName)) return false;
      }
    }
    return true;
  });
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
    ? createAutoSlashCommandHook({ skills: mergedSkills })
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

  const hookExecutor = createHookExecutor();
  hookExecutor.setLogger((message) => {
    log(`[hook-executor] ${message}`);
  });

  const runHook = async (
    hookName: string,
    execute: (() => Promise<void> | void | undefined) | undefined,
  ) => {
    if (!execute) {
      return;
    }

    await hookExecutor.execute({
      name: hookName,
      execute: async () => {
        await execute();
        return { success: true };
      },
    });
  };

  return {
    tool: {
      ...builtinTools,
      ...backgroundTools,
      call_omo_agent: callOmoAgent,
      ...(lookAt ? { look_at: lookAt } : {}),
      delegate_task: delegateTask,
      skill: skillTool,
      skill_mcp: skillMcpTool,
      slashcommand: slashcommandTool,
      interactive_bash,
      ...taskToolsRecord,
    },

    // onSummarize hook - injects context preservation prompt during compaction
    onSummarize: compactionContextInjector,

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

      await runHook("stop-continuation-guard.chat.message", () =>
        stopContinuationGuard?.["chat.message"]?.(input),
      );
      await runHook("keyword-detector.chat.message", () =>
        keywordDetector?.["chat.message"]?.(input, output),
      );
      await runHook("skill-auto-trigger.chat.message", () =>
        skillAutoTrigger?.["chat.message"]?.(input, output),
      );
      await runHook("agent-skill-reminder.chat.message", () =>
        agentSkillReminder?.["chat.message"]?.(input, output),
      );
      await runHook("tdd-guard.chat.message", () =>
        tddGuard?.["chat.message"]?.(input, output),
      );
      await runHook("claude-code-hooks.chat.message", () =>
        claudeCodeHooks["chat.message"]?.(input, output),
      );
      await runHook("auto-slash-command.chat.message", () =>
        autoSlashCommand?.["chat.message"]?.(input, output),
      );
      await runHook("start-work.chat.message", () =>
        startWork?.["chat.message"]?.(input, output),
      );
      // Phase 3 hooks - fixed to use createTextPart for proper Part schema
      await runHook("skill-auto-injector.chat.message", () =>
        skillAutoInjector?.["chat.message"]?.(input, output),
      );
      await runHook("phase-rules-injector.chat.message", () =>
        phaseRulesInjector?.["chat.message"]?.(input, output),
      );
      await runHook("project-context-injector.chat.message", () =>
        projectContextInjector?.["chat.message"]?.(input, output),
      );
      await runHook("pr-context-injector.chat.message", () =>
        prContextInjector?.["chat.message"]?.(input, output),
      );

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
      await runHook("context-injector-messages-transform.experimental", () =>
        contextInjectorMessagesTransform?.[
          "experimental.chat.messages.transform"
        ]?.(input, output as any),
      );
      await runHook("thinking-block-validator.experimental", () =>
        thinkingBlockValidator?.[
          "experimental.chat.messages.transform"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ]?.(input, output as any),
      );
    },

    config: configHandler,

    event: async (input) => {
      await runHook("auto-update-checker.event", () => autoUpdateChecker?.event(input));
      await runHook("claude-code-hooks.event", () => claudeCodeHooks.event(input));
      await runHook("background-notification.event", () =>
        backgroundNotificationHook?.event(input),
      );
      await runHook("session-notification.event", () => sessionNotification?.(input));
      await runHook("todo-continuation-enforcer.event", () =>
        todoContinuationEnforcer?.handler(input),
      );
      await runHook("unstable-agent-babysitter.event", () =>
        unstableAgentBabysitter?.event(input),
      );
      await runHook("context-window-monitor.event", () =>
        contextWindowMonitor?.event(input),
      );
      await runHook("directory-agents-injector.event", () =>
        directoryAgentsInjector?.event(input),
      );
      await runHook("directory-readme-injector.event", () =>
        directoryReadmeInjector?.event(input),
      );
      await runHook("rules-injector.event", () => rulesInjector?.event(input));
      await runHook("think-mode.event", () => thinkMode?.event(input));
      await runHook("anthropic-context-window-limit-recovery.event", () =>
        anthropicContextWindowLimitRecovery?.event(input),
      );
      await runHook("agent-usage-reminder.event", () =>
        agentUsageReminder?.event(input),
      );
      await runHook("agent-skill-reminder.event", () =>
        agentSkillReminder?.event(input),
      );
      await runHook("category-skill-reminder.event", () =>
        categorySkillReminder?.event(input),
      );
      await runHook("interactive-bash-session.event", () =>
        interactiveBashSession?.event(input),
      );
      await runHook("ralph-loop.event", () => ralphLoop?.event(input));
      if (sessionScorer && sessionScorer.event) {
        await runHook("session-scorer.event", () => sessionScorer?.event?.(input));
      }
      await runHook("tdd-guard.event", () => tddGuard?.event?.(input));
      await runHook("plan-reorganizer.event", () => planReorganizer?.handler(input));
      await runHook("stop-continuation-guard.event", () =>
        stopContinuationGuard?.event(input),
      );
      await runHook("atlas.event", () => atlasHook?.handler(input));
      await runHook("observer-detector.event", () => observerDetector?.event(input as any));
      await runHook("instinct-learner.event", () => instinctLearner?.event(input as any));
      await runHook("pattern-extraction.event", () => patternExtraction?.event(input as any));
      await runHook("skill-auto-injector.event", () => skillAutoInjector?.event(input as any));
      await runHook("final-audit.event", () => {
        const eventType = input.event.type as string;
        if (eventType !== "session.stop") {
          return;
        }

        void finalAudit
          .runAudit()
          .then((result) => {
            const report = finalAudit.generateReport(result);
            log("[final-audit] Stop-stage final audit completed", {
              overallSuccess: result.overallSuccess,
            });
            log(`[final-audit]\n${report}`);
          })
          .catch((error) => {
            log("[final-audit] Stop-stage final audit failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      });

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
      await runHook("subagent-question-blocker.tool.execute.before", () =>
        subagentQuestionBlocker["tool.execute.before"]?.(input, output),
      );
      await runHook("write-existing-file-guard.tool.execute.before", () =>
        writeExistingFileGuard?.["tool.execute.before"]?.(input, output),
      );
      await runHook("tasks-md-creation-guard.tool.execute.before", () =>
        tasksMdCreationGuard?.["tool.execute.before"]?.(input, output),
      );
      await runHook("question-label-truncator.tool.execute.before", () =>
        questionLabelTruncator["tool.execute.before"]?.(input, output),
      );
      await runHook("claude-code-hooks.tool.execute.before", () =>
        claudeCodeHooks["tool.execute.before"](input, output),
      );
      await runHook("non-interactive-env.tool.execute.before", () =>
        nonInteractiveEnv?.["tool.execute.before"](input, output),
      );
      await runHook("comment-checker.tool.execute.before", () =>
        commentChecker?.["tool.execute.before"]?.(input, output),
      );
      await runHook("directory-agents-injector.tool.execute.before", () =>
        directoryAgentsInjector?.["tool.execute.before"]?.(input, output),
      );
      await runHook("directory-readme-injector.tool.execute.before", () =>
        directoryReadmeInjector?.["tool.execute.before"]?.(input, output),
      );
      await runHook("rules-injector.tool.execute.before", () =>
        rulesInjector?.["tool.execute.before"]?.(input, output),
      );
      await runHook("commit-size-checker.tool.execute.before", () =>
        commitSizeChecker?.["tool.execute.before"]?.(input, output),
      );
      // Note: tasksTodowriteDisabler NOT registered to keep TodoWrite available
      await runHook("prometheus-md-only.tool.execute.before", () =>
        prometheusMdOnly?.["tool.execute.before"]?.(input, output),
      );
      await runHook("tdd-guard.tool.execute.before", () =>
        tddGuard?.["tool.execute.before"]?.(input, output),
      );
      await runHook("codebase-assessment.tool.execute.before", () =>
        codebaseAssessment?.["tool.execute.before"]?.(input, output),
      );
      await runHook("mdsel-reminder.tool.execute.before", () =>
        mdselReminder?.["tool.execute.before"]?.(input, output),
      );
      await runHook("sisyphus-junior-notepad.tool.execute.before", () =>
        sisyphusJuniorNotepad?.["tool.execute.before"]?.(input, output),
      );
      await runHook("notepad-write-guard.tool.execute.before", () =>
        notepadWriteGuard?.["tool.execute.before"]?.(input, output),
      );
      await runHook("observation-write-guard.tool.execute.before", () =>
        observationWriteGuard?.["tool.execute.before"]?.(input, output),
      );
      await runHook("secret-scanner.tool.execute.before", () =>
        secretScanner?.["tool.execute.before"]?.(input, output),
      );
      
      // Check if any hook blocked the operation
      if ((output as { blocked?: boolean }).blocked) {
        const blockMessage = (output as { message?: string }).message || "Operation blocked by hook";
        throw new Error(blockMessage);
      }
      
      await runHook("instinct-trigger.tool.execute.before", () =>
        instinctTrigger?.["tool.execute.before"]?.(input, output),
      );
      await runHook("plan-update-reminder.tool.execute.before", () =>
        planUpdateReminder?.["tool.execute.before"]?.(input, output),
      );
      await runHook("knowledge-injection.tool.execute.before", () =>
        knowledgeInjection?.["tool.execute.before"]?.(input, output),
      );
      await runHook("atlas.tool.execute.before", () =>
        atlasHook?.["tool.execute.before"]?.(input, output),
      );

      if (input.tool === "task") {
        const args = output.args as Record<string, unknown>;
        const subagentType = args.subagent_type as string;
        const isExploreOrLibrarian = ["explore", "librarian"].some(
          (name) => name.toLowerCase() === (subagentType ?? "").toLowerCase(),
        );

        args.tools = {
          ...(args.tools as Record<string, boolean> | undefined),
          delegate_task: false,
          ...(isExploreOrLibrarian ? { call_omo_agent: false } : {}),
        };
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
      await runHook("claude-code-hooks.tool.execute.after", () =>
        claudeCodeHooks["tool.execute.after"](input, output),
      );
      await runHook("tasks-md-creation-guard.tool.execute.after", () =>
        tasksMdCreationGuard?.["tool.execute.after"]?.(input, output),
      );
      await runHook("tool-output-truncator.tool.execute.after", () =>
        toolOutputTruncator?.["tool.execute.after"](input, output),
      );
      await runHook("preemptive-compaction.tool.execute.after", () =>
        preemptiveCompaction?.["tool.execute.after"](input, output),
      );
      await runHook("context-window-monitor.tool.execute.after", () =>
        contextWindowMonitor?.["tool.execute.after"](input, output),
      );
      await runHook("comment-checker.tool.execute.after", () =>
        commentChecker?.["tool.execute.after"](input, output),
      );
      await runHook("directory-agents-injector.tool.execute.after", () =>
        directoryAgentsInjector?.["tool.execute.after"](input, output),
      );
      await runHook("directory-readme-injector.tool.execute.after", () =>
        directoryReadmeInjector?.["tool.execute.after"](input, output),
      );
      await runHook("rules-injector.tool.execute.after", () =>
        rulesInjector?.["tool.execute.after"](input, output),
      );
      await runHook("empty-task-response-detector.tool.execute.after", () =>
        emptyTaskResponseDetector?.["tool.execute.after"](input, output),
      );
      await runHook("agent-usage-reminder.tool.execute.after", () =>
        agentUsageReminder?.["tool.execute.after"](input, output),
      );
      await runHook("category-skill-reminder.tool.execute.after", () =>
        categorySkillReminder?.["tool.execute.after"](input, output),
      );
      await runHook("interactive-bash-session.tool.execute.after", () =>
        interactiveBashSession?.["tool.execute.after"](input, output),
      );
      await runHook("edit-error-recovery.tool.execute.after", () =>
        editErrorRecovery?.["tool.execute.after"](input, output),
      );
      await runHook("delegate-task-retry.tool.execute.after", () =>
        delegateTaskRetry?.["tool.execute.after"](input, output),
      );
      await runHook("atlas.tool.execute.after", () =>
        atlasHook?.["tool.execute.after"]?.(input, output),
      );
      await runHook("task-resume-info.tool.execute.after", () =>
        taskResumeInfo["tool.execute.after"](input, output),
      );
      await runHook("plan-update-reminder.tool.execute.after", () =>
        planUpdateReminder?.["tool.execute.after"]?.(input, output),
      );
      await runHook("tdd-guard.tool.execute.after", () =>
        tddGuard?.["tool.execute.after"]?.(input, output),
      );
      await runHook("planning-flow-guide.tool.execute.after", () =>
        planningFlowGuide?.["tool.execute.after"]?.(input, output),
      );
      await runHook("subagent-verification.tool.execute.after", () =>
        subagentVerification?.["tool.execute.after"]?.(input, output),
      );
      await runHook("lsp-diagnostics-enforcer.tool.execute.after", () =>
        lspDiagnosticsEnforcer?.["tool.execute.after"]?.(input, output),
      );
      await runHook("phase-flow-enforcer.tool.execute.after", () =>
        phaseFlowEnforcer?.["tool.execute.after"]?.(input, output),
      );
      await runHook("mdsel-reminder.tool.execute.after", () =>
        mdselReminder?.["tool.execute.after"]?.(input, output),
      );
      await runHook("observation-recorder.tool.execute.after", () =>
        observationRecorder?.["tool.execute.after"]?.(input, output),
      );
      await runHook("observer-detector.tool.execute.after", () =>
        observerDetector?.["tool.execute.after"]?.(input, output),
      );
      await runHook("instinct-learner.tool.execute.after", () =>
        instinctLearner?.["tool.execute.after"]?.(input, output),
      );
      await runHook("behavior-anchor.tool.execute.after", () =>
        behaviorAnchor?.["tool.execute.after"]?.(input, output),
      );
      await runHook("verbosity-controller.tool.execute.after", () =>
        verbosityController?.["tool.execute.after"]?.(input, output),
      );
    },

    "experimental.session.compacting": async (input: { sessionID: string }) => {
      if (!compactionContextInjector) {
        return;
      }
      await runHook("compaction-context-injector.experimental.session.compacting", () =>
        compactionContextInjector({
          sessionID: input.sessionID,
          providerID: "anthropic",
          modelID: "claude-opus-4-5",
          usageRatio: 0.8,
          directory: ctx.directory,
        }),
      );
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
