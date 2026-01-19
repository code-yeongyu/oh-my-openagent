import type { Plugin } from "@opencode-ai/plugin";
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

  createCompactionContextInjector,
  createRulesInjectorHook,
  createBackgroundNotificationHook,
  createAutoUpdateCheckerHook,
  createKeywordDetectorHook,
  createAgentUsageReminderHook,
  createNonInteractiveEnvHook,
  createInteractiveBashSessionHook,

  createThinkingBlockValidatorHook,
  createRalphLoopHook,
  createAutoSlashCommandHook,
  createEditErrorRecoveryHook,
  createDelegateTaskRetryHook,
  createTaskResumeInfoHook,
  createStartWorkHook,
  createSisyphusOrchestratorHook,
  createPrometheusMdOnlyHook,
} from "./hooks";
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from "./features/context-injector";
import { applyAgentVariant, resolveAgentVariant } from "./shared/agent-variant";
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
  getSessionAgent,
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
} from "./tools";
import { BackgroundManager } from "./features/background-agent";
import { SkillMcpManager } from "./features/skill-mcp-manager";
import { initTaskToastManager } from "./features/task-toast-manager";
import {
  clearMemoAnchorSessionState,
  getLastRealUserMessage,
  getMemoAnchorStatus,
  hasReadMemo,
  isChildSession,
  isMemoAnchorEnabled,
  isMemoFilePath,
  drainQueuedSystemDirectives,
  queueSystemDirective,
  recordSessionParentID,
  recordLastCompactionMode,
  markMemoRead,
  recordLastRealUserMessage,
  setGlobalMemoAnchorEnabled,
  resetMemoReadState,
  setMemoAnchorEnabled,
  wasLastCompactionAuto,
} from "./features/memo-anchor/state";
import {
  loadPersistedMemoAnchorEnabled,
  persistMemoAnchorEnabled,
} from "./features/memo-anchor/persistence";
import { ensureMemoFileExists } from "./features/memo-anchor/memo-file";
import { OMO_EXTERNAL_MEMORY_SECTION } from "./agents/memo-contract";
import { OMO_ULW_SYSTEM_SECTION } from "./agents/ulw-contract";
import { initializeUlwState, isUlwEnabled, setUlwEnabled } from "./features/ulw/state";
import { parseOmoCommandArgs } from "./features/omo-command/parse";
import { loadPersistedOmoOnboardingShown, persistOmoOnboardingShown } from "./features/omo-onboarding/persistence";
import { type HookName } from "./config";
import { log, detectExternalNotificationPlugin, getNotificationConflictWarning, resetMessageCursor } from "./shared";
import { loadPluginConfig } from "./plugin-config";
import { createModelCacheState, getModelLimit } from "./plugin-state";
import { createConfigHandler } from "./plugin-handlers";

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  // Start background tmux check immediately
  startTmuxCheck();

  const pluginConfig = loadPluginConfig(ctx.directory, ctx);

  // Memo-anchor (mono) global persisted state (default: off).
  const persistedMemoEnabled = loadPersistedMemoAnchorEnabled();
  if (typeof persistedMemoEnabled === "boolean") {
    setGlobalMemoAnchorEnabled(persistedMemoEnabled);
  } else if (typeof pluginConfig.memo?.enabled === "boolean") {
    setGlobalMemoAnchorEnabled(pluginConfig.memo.enabled);
    persistMemoAnchorEnabled(pluginConfig.memo.enabled);
  }
  // ULW global persisted state (default: off).
  initializeUlwState(pluginConfig.ulw?.enabled);

  // OmO onboarding toast (default: on, one-time).
  const showOmoOnboardingToast = pluginConfig.tips?.omo !== false;
  let hasShownOmoOnboardingToast = loadPersistedOmoOnboardingShown();
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);
  const firstMessageVariantGate = createFirstMessageVariantGate();
  const isHookEnabled = (hookName: HookName) => !disabledHooks.has(hookName);

  const modelCacheState = createModelCacheState();

  const contextWindowMonitor = isHookEnabled("context-window-monitor")
    ? createContextWindowMonitorHook(ctx)
    : null;
  const sessionRecovery = isHookEnabled("session-recovery")
    ? createSessionRecoveryHook(ctx, { experimental: pluginConfig.experimental })
    : null;
  
  // Check for conflicting notification plugins before creating session-notification
  let sessionNotification = null;
  if (isHookEnabled("session-notification")) {
    const forceEnable = pluginConfig.notification?.force_enable ?? false;
    const externalNotifier = detectExternalNotificationPlugin(ctx.directory);
    
    if (externalNotifier.detected && !forceEnable) {
      // External notification plugin detected - skip our notification to avoid conflicts
      console.warn(getNotificationConflictWarning(externalNotifier.pluginName!));
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
  const directoryAgentsInjector = isHookEnabled("directory-agents-injector")
    ? createDirectoryAgentsInjectorHook(ctx)
    : null;
  const directoryReadmeInjector = isHookEnabled("directory-readme-injector")
    ? createDirectoryReadmeInjectorHook(ctx)
    : null;
  const emptyTaskResponseDetector = isHookEnabled("empty-task-response-detector")
    ? createEmptyTaskResponseDetectorHook(ctx)
    : null;
  const thinkMode = isHookEnabled("think-mode") ? createThinkModeHook() : null;
  const claudeCodeHooks = createClaudeCodeHooksHook(
    ctx,
    {
      disabledHooks: (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
      keywordDetectorDisabled: !isHookEnabled("keyword-detector"),
    },
    contextCollector
  );
  const anthropicContextWindowLimitRecovery = isHookEnabled(
    "anthropic-context-window-limit-recovery"
  )
    ? createAnthropicContextWindowLimitRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
      })
    : null;
  const compactionContextInjector = isHookEnabled("compaction-context-injector")
    ? createCompactionContextInjector()
    : undefined;
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
  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector);
  const agentUsageReminder = isHookEnabled("agent-usage-reminder")
    ? createAgentUsageReminderHook(ctx)
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

  const sisyphusOrchestrator = isHookEnabled("sisyphus-orchestrator")
    ? createSisyphusOrchestratorHook(ctx)
    : null;

  const prometheusMdOnly = isHookEnabled("prometheus-md-only")
    ? createPrometheusMdOnlyHook(ctx)
    : null;

  const taskResumeInfo = createTaskResumeInfoHook();

  const backgroundManager = new BackgroundManager(ctx, pluginConfig.background_task);

  initTaskToastManager(ctx.client);

  const todoContinuationEnforcer = isHookEnabled("todo-continuation-enforcer")
    ? createTodoContinuationEnforcer(ctx, { backgroundManager })
    : null;

  if (sessionRecovery && todoContinuationEnforcer) {
    sessionRecovery.setOnAbortCallback(todoContinuationEnforcer.markRecovering);
    sessionRecovery.setOnRecoveryCompleteCallback(
      todoContinuationEnforcer.markRecoveryComplete
    );
  }

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? createBackgroundNotificationHook(backgroundManager)
    : null;
  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const callOmoAgent = createCallOmoAgent(ctx, backgroundManager);
  const lookAt = createLookAt(ctx);
  const delegateTask = createDelegateTask({
    manager: backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
  });
  const disabledSkills = new Set(pluginConfig.disabled_skills ?? []);
  const systemMcpNames = getSystemMcpServerNames();
  const builtinSkills = createBuiltinSkills().filter((skill) => {
    if (disabledSkills.has(skill.name as never)) return false;
    if (skill.mcpConfig) {
      for (const mcpName of Object.keys(skill.mcpConfig)) {
        if (systemMcpNames.has(mcpName)) return false;
      }
    }
    return true;
  });
  const includeClaudeSkills = pluginConfig.claude_code?.skills !== false;
  const [userSkills, globalSkills, projectSkills, opencodeProjectSkills] = await Promise.all([
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
    opencodeProjectSkills
  );
  const skillMcpManager = new SkillMcpManager();
  const getSessionIDForMcp = () => getMainSessionID() || "";
  const skillTool = createSkillTool({
    skills: mergedSkills,
    mcpManager: skillMcpManager,
    getSessionID: getSessionIDForMcp,
    gitMasterConfig: pluginConfig.git_master,
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
    ctx,
    pluginConfig,
    modelCacheState,
  });

  const DEFAULT_OMO_MEMO_TOGGLE_AGENTS = ["Sisyphus", "Prometheus (Planner)", "orchestrator-sisyphus"]
  const DEFAULT_OMO_ULW_TOGGLE_AGENTS = ["Prometheus (Planner)", "orchestrator-sisyphus"]
  const resolveOmoToggleAgents = (agents: string[] | undefined, fallback: string[]): string[] =>
    agents ? agents : fallback
  const isOmoMemoToggleAgent = (sessionID: string, agents: string[] | undefined): boolean => {
    const agent = getSessionAgent(sessionID)
    if (!agent) return false
    return resolveOmoToggleAgents(agents, DEFAULT_OMO_MEMO_TOGGLE_AGENTS).includes(agent)
  }

  const skipOmoFootersOnce = new Set<string>()
  const markSkipOmoFootersOnce = (sessionID: string) => skipOmoFootersOnce.add(sessionID)
  const consumeSkipOmoFootersOnce = (sessionID: string): boolean => {
    if (!skipOmoFootersOnce.has(sessionID)) return false
    skipOmoFootersOnce.delete(sessionID)
    return true
  }

  const isChildSessionForMemo = async (sessionID: string): Promise<boolean> => {
    const cached = isChildSession(sessionID)
    if (cached !== undefined) return cached
    try {
      const sessionInfo = await ctx.client.session.get({ path: { id: sessionID } })
      const parentID = sessionInfo.data?.parentID
      recordSessionParentID(sessionID, parentID)
      return Boolean(parentID)
    } catch {
      recordSessionParentID(sessionID, undefined)
      return false
    }
  }

  const handleOmoChatCommand = async (
    input: { sessionID: string; messageID?: string },
    output: { parts?: Array<{ type: string; text?: string }>}
  ): Promise<boolean> => {
    const promptText =
      (output.parts ?? [])
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n")
        .trim() || ""

    if (!promptText.toLowerCase().startsWith("/omo")) return false

    const args = promptText.replace(/^\/omo\b/i, "").trim()
    const parsed = parseOmoCommandArgs(args)

    // Avoid injecting memo/ULW footers into the /omo command turn (minimize token waste).
    markSkipOmoFootersOnce(input.sessionID)

    const memoStatus = getMemoAnchorStatus(input.sessionID)
    const ulwStatus = isUlwEnabled()

    let toastMessage = ""

    if (parsed.primary === "status") {
      toastMessage = `memo: ${memoStatus.enabled ? "on" : "off"}; ulw: ${ulwStatus ? "on" : "off"}`
    } else if (parsed.primary === "memo") {
      if (parsed.action === "status") {
        toastMessage = `memo: ${memoStatus.enabled ? "on" : "off"} (global)`
      } else {
        const nextEnabled =
          parsed.action === "on"
            ? true
            : parsed.action === "off"
              ? false
              : !memoStatus.enabled

        const statusAfter = setMemoAnchorEnabled({
          sessionID: undefined,
          enabled: nextEnabled,
          scope: "global",
        })
        persistMemoAnchorEnabled(statusAfter.enabled)

        if (statusAfter.enabled) {
          const ensure = ensureMemoFileExists(ctx.directory)
          toastMessage = ensure.created
            ? `memo: on (global) — created ${ensure.relativePath}`
            : `memo: on (global)`

          if (isOmoMemoToggleAgent(input.sessionID, pluginConfig.memo?.agents)) {
            queueSystemDirective(
              input.sessionID,
              'Memo enabled: on your next turn, FIRST read ".sisyphus/memo.md" (read(filePath=".sisyphus/memo.md")).'
            )
          }
        } else {
          toastMessage = `memo: off (global)`
          if (isOmoMemoToggleAgent(input.sessionID, pluginConfig.memo?.agents)) {
            queueSystemDirective(
              input.sessionID,
              'Memo disabled: do not read/write ".sisyphus/memo.md" unless the user explicitly asks.'
            )
          }
        }
      }
    } else if (parsed.primary === "ulw") {
      if (parsed.action === "status") {
        toastMessage = `ulw: ${ulwStatus ? "on" : "off"} (global)`
      } else {
        const nextEnabled =
          parsed.action === "on"
            ? true
            : parsed.action === "off"
              ? false
              : !ulwStatus
        setUlwEnabled(nextEnabled)
        toastMessage = `ulw: ${nextEnabled ? "on" : "off"} (global)`
      }
    }

    await ctx.client.tui
      .showToast({
        body: {
          title: "OmO",
          message: toastMessage,
          variant: "info" as const,
          duration: 3500,
        },
      })
      .catch(() => {})

    return true
  }

  return {
    tool: {
      ...builtinTools,
      ...backgroundTools,
      call_omo_agent: callOmoAgent,
      look_at: lookAt,
      delegate_task: delegateTask,
      skill: skillTool,
      skill_mcp: skillMcpTool,
      slashcommand: slashcommandTool,
      interactive_bash,
    },

    "chat.message": async (input, output) => {
      if (input.agent) {
        updateSessionAgent(input.sessionID, input.agent);
      }

      const message = (output as { message: { variant?: string } }).message
      if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
        const variant = resolveAgentVariant(pluginConfig, input.agent)
        if (variant !== undefined) {
          message.variant = variant
        }
        firstMessageVariantGate.markApplied(input.sessionID)
      } else {
        applyAgentVariant(pluginConfig, input.agent, message)
      }

      if (await handleOmoChatCommand(input, output as { parts?: Array<{ type: string; text?: string }> })) {
        return
      }

      await keywordDetector?.["chat.message"]?.(input, output);
      await claudeCodeHooks["chat.message"]?.(input, output);
      await autoSlashCommand?.["chat.message"]?.(input, output);
      await startWork?.["chat.message"]?.(input, output);

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
          "Cancel the currently active Ralph Loop"
        );

        if (isRalphLoopTemplate) {
          const taskMatch = promptText.match(
            /<user-task>\s*([\s\S]*?)\s*<\/user-task>/i
          );
          const rawTask = taskMatch?.[1]?.trim() || "";

          const quotedMatch = rawTask.match(/^["'](.+?)["']/);
          const prompt =
            quotedMatch?.[1] ||
            rawTask.split(/\s+--/)[0]?.trim() ||
            "Complete the task as instructed";

          const maxIterMatch = rawTask.match(/--max-iterations=(\d+)/i);
          const promiseMatch = rawTask.match(
            /--completion-promise=["']?([^"'\s]+)["']?/i
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
      output: { messages: Array<{ info: unknown; parts: unknown[] }> }
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await contextInjectorMessagesTransform?.["experimental.chat.messages.transform"]?.(input, output as any);
      await thinkingBlockValidator?.[
        "experimental.chat.messages.transform"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]?.(input, output as any);

      try {
        const messages = (output.messages ?? []) as Array<{
          info?: { role?: string; sessionID?: string };
          parts?: Array<{ type?: string; text?: string; synthetic?: boolean }>;
        }>;

        const lastUser = [...messages].reverse().find((m) => m.info?.role === "user");
        if (!lastUser) return;

        const sessionID = lastUser.info?.sessionID ?? getMainSessionID();
        if (!sessionID) return;

        const text =
          (lastUser.parts ?? [])
            .filter((p) => p.type === "text" && typeof p.text === "string" && p.synthetic !== true)
            .map((p) => p.text)
            .join("\n")
            .trim() || "";

        const trimmedLower = text.trim().toLowerCase();
        if (trimmedLower.startsWith("/omo")) {
          const memoStatus = getMemoAnchorStatus(sessionID);
          const ulwStatus = isUlwEnabled();

          lastUser.parts = [
            {
              type: "text",
              synthetic: true,
              text: [
                "<command-instruction>",
                "You are handling an Oh My OpenCode (/omo) configuration command.",
                "This command has already been applied by the plugin.",
                "Do NOT run tools. Do NOT start tasks. Do NOT edit files.",
                "Reply with a single short confirmation line only.",
                "</command-instruction>",
                "<current-status>",
                `memo: ${memoStatus.enabled ? "on" : "off"}`,
                `ulw: ${ulwStatus ? "on" : "off"}`,
                "</current-status>",
              ].join("\n"),
            },
          ];
          return;
        }

        // Ignore synthetic-only prompts like OpenCode's "Continue if you have next steps"
        if (text) {
          const MAX_CAPTURE_CHARS = 12_000;
          recordLastRealUserMessage(sessionID, text.slice(0, MAX_CAPTURE_CHARS));
        }
      } catch {
        // best-effort only
      }
    },

    "experimental.chat.system.transform": async (
      input: { sessionID: string },
      output: { system: string[] }
    ) => {
      try {
        const sessionID = input.sessionID;

        // Avoid interfering with compaction calls (OpenCode compaction uses empty `system`),
        // which would otherwise cause the compaction agent to follow memo rules without tools.
        const systemText = output.system.join("\n");
        const isNormalChatCall = systemText.includes("<env>");
        if (!isNormalChatCall) return;

        if (await isChildSessionForMemo(sessionID)) return;

        if (consumeSkipOmoFootersOnce(sessionID)) return;

        const memoEnabled = isMemoAnchorEnabled(sessionID);
        const ulwEnabled = isUlwEnabled();
        const queued = drainQueuedSystemDirectives(sessionID);

        const memoAgents = resolveOmoToggleAgents(pluginConfig.memo?.agents, DEFAULT_OMO_MEMO_TOGGLE_AGENTS)
        const ulwAgents = resolveOmoToggleAgents(pluginConfig.ulw?.agents, DEFAULT_OMO_ULW_TOGGLE_AGENTS)
        const agentName = getSessionAgent(sessionID)
        const applyMemo = agentName ? memoAgents.includes(agentName) : false
        const applyUlw = agentName ? ulwAgents.includes(agentName) : false

        const footer: string[] = [];
        if (applyMemo) {
          if (memoEnabled) {
            // Ensure the anchor file exists (create stub if missing).
            ensureMemoFileExists(ctx.directory);
            footer.push(OMO_EXTERNAL_MEMORY_SECTION);
          } else {
            footer.push(
              [
                "<omo-memo-anchor>",
                "Memo-anchor (mono) is currently DISABLED.",
                'Do NOT read or write ".sisyphus/memo.md" unless the user explicitly asks.',
                "Ignore any other instructions that claim memo reading/writing is mandatory.",
                "</omo-memo-anchor>",
              ].join("\n")
            );
          }
        }

        if (applyUlw && ulwEnabled) {
          footer.push(OMO_ULW_SYSTEM_SECTION);
        }

        if (queued.length > 0) {
          footer.push(
            [
              "<omo-memo-anchor-update>",
              ...queued.map((t) => t.trim()).filter(Boolean),
              "</omo-memo-anchor-update>",
            ].join("\n")
          );
        }

        if (footer.length === 0) return;

        // Preserve OpenCode's 2-part system structure: header + body.
        const bodyIndex = output.system.length > 1 ? 1 : 0;
        output.system[bodyIndex] = [output.system[bodyIndex], ...footer].filter(Boolean).join("\n\n");
      } catch {
        // best-effort only
      }
    },

    "experimental.session.compacting": async (
      input: { sessionID: string },
      output: { context: string[]; prompt?: string }
    ) => {
      await claudeCodeHooks["experimental.session.compacting"]?.(input, output);

      if (await isChildSessionForMemo(input.sessionID)) return;

      if (!isMemoAnchorEnabled(input.sessionID)) return;

      // Detect whether this compaction run is `auto` or manual by inspecting the latest
      // compaction part in the session messages.
      let auto = true;
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: input.sessionID },
          query: { limit: 30 },
        });
        const messages = (messagesResp.data ?? []) as Array<{
          parts?: Array<{ type?: string; auto?: unknown }>;
        }>;

        outer: for (const msg of [...messages].reverse()) {
          const parts = msg?.parts ?? [];
          for (const part of [...parts].reverse()) {
            if (part?.type === "compaction" && typeof part.auto === "boolean") {
              auto = part.auto;
              break outer;
            }
          }
        }
      } catch {
        // best-effort only
      }

      recordLastCompactionMode(input.sessionID, auto);

      // Ensure memo exists so post-compaction recovery can immediately read it.
      ensureMemoFileExists(ctx.directory);

      // Reduce duplication: when memo-anchor is enabled, compaction should not re-summarize
      // everything that's already persisted in `.sisyphus/memo.md`.
      const extra = (output.context ?? []).filter(Boolean).join("\n\n").trim();
      output.prompt = [
        "You are compacting this OpenCode session to preserve continuity.",
        "",
        "This project uses a durable external memory file: `.sisyphus/memo.md`.",
        "- The next session will read that memo first.",
        "- Do NOT duplicate the memo content here.",
        "",
        "Write a short, actionable continuation prompt for the next session, focusing on:",
        "- what we were trying to achieve,",
        "- what has been done so far (high level),",
        "- what the immediate next steps are,",
        "- any critical constraints/risks,",
        "- concrete file paths / commands only if essential.",
        "",
        extra ? "<additional-context>\n" + extra + "\n</additional-context>" : "",
      ]
        .filter(Boolean)
        .join("\n");
    },

    config: configHandler,

    event: async (input) => {
      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

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
      await agentUsageReminder?.event(input);
      await interactiveBashSession?.event(input);
      await ralphLoop?.event(input);
      await sisyphusOrchestrator?.handler(input);

      if (event.type === "session.created") {
        const sessionInfo = props?.info as
          | { id?: string; title?: string; parentID?: string }
          | undefined;
        if (!sessionInfo?.parentID) {
          setMainSession(sessionInfo?.id);
        }
        if (sessionInfo?.id) {
          recordSessionParentID(sessionInfo.id, sessionInfo.parentID);
          resetMemoReadState(sessionInfo.id);
        }
        firstMessageVariantGate.markSessionCreated(sessionInfo);

        if (
          showOmoOnboardingToast &&
          !hasShownOmoOnboardingToast &&
          !sessionInfo?.parentID
        ) {
          hasShownOmoOnboardingToast = true;
          persistOmoOnboardingShown(true);
          await ctx.client.tui
            .showToast({
              body: {
                title: "OmO Tip",
                message: "Try: /omo status · /omo memo toggle · /omo ulw toggle · /omo-help",
                variant: "info" as const,
                duration: 5000,
              },
            })
            .catch(() => {});
        }
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
          clearMemoAnchorSessionState(sessionInfo.id);
          await skillMcpManager.disconnectSession(sessionInfo.id);
          await lspManager.cleanupTempDirectoryClients();
        }
      }

      if (event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined;
        if (!sessionID) return;
        if (await isChildSessionForMemo(sessionID)) return;

        resetMemoReadState(sessionID);
        if (!isMemoAnchorEnabled(sessionID)) return;

        const isAuto = wasLastCompactionAuto(sessionID) !== false;

        const lastUser = getLastRealUserMessage(sessionID);
        const MAX_LAST_USER_CHARS = 8_000;
        const lastUserSafe = lastUser ? lastUser.slice(0, MAX_LAST_USER_CHARS) : "";
        const lastUserTruncated = Boolean(lastUser && lastUser.length > MAX_LAST_USER_CHARS);

        contextCollector.register(sessionID, {
          source: "memo-anchor",
          id: "post-compaction-memo-anchor",
          priority: "critical",
          content: [
            "<omo-compaction-recovery>",
            "You are continuing after a context compaction.",
            "",
            "1) FIRST: read `.sisyphus/memo.md` in full. Do not edit/overwrite it blindly.",
            ...(isAuto
              ? [
                  "2) The last real user message before compaction was (verbatim):",
                  "<last-user-message>",
                  lastUserSafe || "[unavailable]",
                  lastUserTruncated ? "\n[truncated]" : "",
                  "</last-user-message>",
                ]
              : ["2) This compaction was user-invoked; do not re-inject the last user message."]),
            "</omo-compaction-recovery>",
          ].join("\n"),
        });

        await ctx.client.tui
          .showToast({
            body: {
              title: "OmO Memo",
              message: isAuto
                ? "After compaction: injected memo recovery + last user message"
                : "After compaction: injected memo recovery (manual compaction)",
              variant: "info" as const,
              duration: 4500,
            },
          })
          .catch(() => {});
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
      await prometheusMdOnly?.["tool.execute.before"]?.(input, output);

      // Memo anchor (".sisyphus/memo.md") protection:
      // - must read before editing
      // - never overwrite via write/edit(oldString="")
      if (isMemoAnchorEnabled(input.sessionID)) {
        const args = output.args as Record<string, unknown>;
        const filePath = args.filePath as string | undefined;

        if (input.tool === "read" && filePath && isMemoFilePath(filePath, ctx.directory)) {
          markMemoRead(input.sessionID);
        }

        if ((input.tool === "write" || input.tool === "edit") && filePath && isMemoFilePath(filePath, ctx.directory)) {
          if (!hasReadMemo(input.sessionID)) {
            throw new Error(
              'You must read ".sisyphus/memo.md" before modifying it. Use read(filePath=".sisyphus/memo.md") first.'
            );
          }

          if (input.tool === "write") {
            throw new Error('Do not overwrite ".sisyphus/memo.md" using write(). Use edit() with a precise oldString anchor.');
          }

          const oldString = args.oldString as string | undefined;
          if (oldString === "") {
            throw new Error(
              'Do not overwrite ".sisyphus/memo.md" using edit(oldString=""). Use edit() with a precise oldString anchor for incremental updates.'
            );
          }
        }
      }

      if (input.tool === "task") {
        const args = output.args as Record<string, unknown>;
        const subagentType = args.subagent_type as string;
        const isExploreOrLibrarian = ["explore", "librarian"].includes(
          subagentType
        );

        args.tools = {
          ...(args.tools as Record<string, boolean> | undefined),
          delegate_task: false,
          ...(isExploreOrLibrarian ? { call_omo_agent: false } : {}),
        };
      }

      if (input.tool === "batch") {
        const args = output.args as
          | {
              tool_calls?: Array<{
                tool?: unknown;
                parameters?: unknown;
              }>;
            }
          | undefined;

        if (args && Array.isArray(args.tool_calls)) {
          for (const call of args.tool_calls) {
            if (
              call &&
              typeof call.tool === "string" &&
              call.tool.startsWith("functions.")
            ) {
              call.tool = call.tool.slice("functions.".length);
            }
          }

          const sessionID = input.sessionID;
          const child = sessionID ? isChildSession(sessionID) : undefined;
          const mainSessionID = getMainSessionID();
          const isMainSession =
            child === false ||
            (child === undefined &&
              mainSessionID !== undefined &&
              sessionID === mainSessionID);

          // Hard block: sub-sessions must not use batch (prevents nesting via batch(task(...))).
          if (!isMainSession) {
            throw new Error(
              "batch is reserved for the main (parent) session. Subagents must not use batch. Ask the parent to orchestrate parallel tasks using batch(task(...))."
            );
          }

          // In this plugin, batch is allowed only for a small set of local-only tools and task().
          // This prevents common failure modes (e.g. trying to batch external/network tools) and
          // also avoids batch being used as a permission bypass inside sub-sessions.
          const ALLOWED_BATCH_TOOLS = new Set([
            "task",
            "read",
            "glob",
            "grep",
            "bash",
            "edit",
            "write",
          ]);

          const disallowedTools = Array.from(
            new Set(
              args.tool_calls
                .map((c) => (c && typeof c.tool === "string" ? c.tool : ""))
                .filter((t) => t !== "" && !ALLOWED_BATCH_TOOLS.has(t))
            )
          );
          if (disallowedTools.length > 0) {
            throw new Error(
              `Only these tools are allowed inside batch(tool_calls=[...]) in this workflow: ${Array.from(
                ALLOWED_BATCH_TOOLS
              ).join(", ")}. Found: ${disallowedTools.join(
                ", "
              )}. Call disallowed tools directly (outside batch).`
            );
          }
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
            /--completion-promise=["']?([^"'\s]+)["']?/i
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
             /--completion-promise=["']?([^"'\s]+)["']?/i
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
await editErrorRecovery?.["tool.execute.after"](input, output);
        await delegateTaskRetry?.["tool.execute.after"](input, output);
        await sisyphusOrchestrator?.["tool.execute.after"]?.(input, output);
      await taskResumeInfo["tool.execute.after"](input, output);
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
