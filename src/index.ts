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
  createEditErrorRecoveryHook,
} from "./hooks";
import {
  contextCollector,
  createContextInjectorHook,
} from "./features/context-injector";
import { createGoogleAntigravityAuthPlugin } from "./auth/antigravity";
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
} from "./features/claude-code-session-state";
import {
  builtinTools,
  createCallOmoAgent,
  createBackgroundTools,
  createLookAt,
  createSkillTool,
  createSkillMcpTool,
  sessionExists,
  interactive_bash,
  getTmuxPath,
} from "./tools";
import { BackgroundManager } from "./features/background-agent";
import { SkillMcpManager } from "./features/skill-mcp-manager";
import { type HookName } from "./config";
import { log } from "./shared";
import { loadPluginConfig } from "./plugin-config";
import { createModelCacheState, getModelLimit } from "./plugin-state";
import { createConfigHandler } from "./plugin-handlers";

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  const pluginConfig = loadPluginConfig(ctx.directory, ctx);
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);
  const isHookEnabled = (hookName: HookName) => !disabledHooks.has(hookName);

  const modelCacheState = createModelCacheState();

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
  const claudeCodeHooks = createClaudeCodeHooksHook(ctx, {
    disabledHooks: (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
  });
  const anthropicContextWindowLimitRecovery = isHookEnabled(
    "anthropic-context-window-limit-recovery"
  )
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
        getModelLimit: (providerID, modelID) =>
          getModelLimit(modelCacheState, providerID, modelID),
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
  const contextInjector = createContextInjectorHook(contextCollector);
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
    ? createRalphLoopHook(ctx, {
        config: pluginConfig.ralph_loop,
        checkSessionExists: async (sessionId) => sessionExists(sessionId),
      })
    : null;

  const autoSlashCommand = isHookEnabled("auto-slash-command")
    ? createAutoSlashCommandHook()
    : null;

  const editErrorRecovery = isHookEnabled("edit-error-recovery")
    ? createEditErrorRecoveryHook(ctx)
    : null;

  const backgroundManager = new BackgroundManager(ctx);

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
  const mergedSkills = mergeSkills(
    builtinSkills,
    pluginConfig.skills,
    includeClaudeSkills ? discoverUserClaudeSkills() : [],
    discoverOpencodeGlobalSkills(),
    includeClaudeSkills ? discoverProjectClaudeSkills() : [],
    discoverOpencodeProjectSkills()
  );
  const skillMcpManager = new SkillMcpManager();
  const getSessionIDForMcp = () => getMainSessionID() || "";
  const skillTool = createSkillTool({
    skills: mergedSkills,
    mcpManager: skillMcpManager,
    getSessionID: getSessionIDForMcp,
  });
  const skillMcpTool = createSkillMcpTool({
    manager: skillMcpManager,
    getLoadedSkills: () => mergedSkills,
    getSessionID: getSessionIDForMcp,
  });

  const [googleAuthHooks, tmuxAvailable] = await Promise.all([
    pluginConfig.google_auth !== false
      ? createGoogleAntigravityAuthPlugin(ctx)
      : Promise.resolve(null),
    getTmuxPath(),
  ]);

  const configHandler = createConfigHandler({
    ctx,
    pluginConfig,
    modelCacheState,
  });

  return {
    ...(googleAuthHooks ? { auth: googleAuthHooks.auth } : {}),

    tool: {
      ...builtinTools,
      ...backgroundTools,
      call_omo_agent: callOmoAgent,
      look_at: lookAt,
      skill: skillTool,
      skill_mcp: skillMcpTool,
      ...(tmuxAvailable ? { interactive_bash } : {}),
    },

    "chat.message": async (input, output) => {
      await claudeCodeHooks["chat.message"]?.(input, output);
      await keywordDetector?.["chat.message"]?.(input, output);
      await contextInjector["chat.message"]?.(input, output);
      await autoSlashCommand?.["chat.message"]?.(input, output);

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
      await thinkingBlockValidator?.[
        "experimental.chat.messages.transform"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]?.(input, output as any);
      await emptyMessageSanitizer?.[
        "experimental.chat.messages.transform"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]?.(input, output as any);
    },

    config: configHandler,

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
        if (sessionInfo?.id) {
          await skillMcpManager.disconnectSession(sessionInfo.id);
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
        const isExploreOrLibrarian = ["explore", "librarian"].includes(
          subagentType
        );

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
