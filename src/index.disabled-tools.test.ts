import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

let currentConfig: Record<string, unknown> = {};

const DUMMY_TOOL = {
  description: "dummy",
  args: {},
  execute: async () => "ok",
};

mock.module("./plugin-config", () => ({
  loadPluginConfig: () => currentConfig,
}));

mock.module("./shared", () => ({
  log: () => {},
  detectExternalNotificationPlugin: () => ({
    detected: false,
    pluginName: null,
    allPlugins: [],
  }),
  getNotificationConflictWarning: () => "",
  resetMessageCursor: () => {},
  hasConnectedProvidersCache: () => true,
  getOpenCodeVersion: () => null,
  isOpenCodeVersionAtLeast: () => false,
  OPENCODE_NATIVE_AGENTS_INJECTION_VERSION: "0.0.0",
  injectServerAuthIntoClient: () => {},
}));

mock.module("./hooks", () => {
  const noopHook = {
    event: async () => {},
    handler: async () => {},
    "chat.message": async () => {},
    "tool.execute.before": async () => {},
    "tool.execute.after": async () => {},
    "experimental.chat.messages.transform": async () => {},
  };

  return {
    createTodoContinuationEnforcer: () => null,
    createContextWindowMonitorHook: () => null,
    createSessionRecoveryHook: () => null,
    createSessionNotification: () => async () => {},
    createCommentCheckerHooks: () => null,
    createToolOutputTruncatorHook: () => null,
    createDirectoryAgentsInjectorHook: () => null,
    createDirectoryReadmeInjectorHook: () => null,
    createEmptyTaskResponseDetectorHook: () => null,
    createThinkModeHook: () => null,
    createClaudeCodeHooksHook: () => noopHook,
    createAnthropicContextWindowLimitRecoveryHook: () => null,
    createRulesInjectorHook: () => null,
    createBackgroundNotificationHook: () => null,
    createAutoUpdateCheckerHook: () => ({ event: async () => {} }),
    createKeywordDetectorHook: () => null,
    createAgentUsageReminderHook: () => null,
    createNonInteractiveEnvHook: () => null,
    createInteractiveBashSessionHook: () => null,
    createThinkingBlockValidatorHook: () => null,
    createCategorySkillReminderHook: () => null,
    createRalphLoopHook: () => null,
    createAutoSlashCommandHook: () => null,
    createEditErrorRecoveryHook: () => null,
    createDelegateTaskRetryHook: () => null,
    createTaskResumeInfoHook: () => ({
      "tool.execute.after": async () => {},
    }),
    createStartWorkHook: () => null,
    createAtlasHook: () => null,
    createPrometheusMdOnlyHook: () => null,
    createSisyphusJuniorNotepadHook: () => null,
    createQuestionLabelTruncatorHook: () => null,
    createSubagentQuestionBlockerHook: () => null,
    createStopContinuationGuardHook: () => null,
    createCompactionContextInjector: () => null,
    createUnstableAgentBabysitterHook: () => null,
    createPreemptiveCompactionHook: () => null,
    createTasksTodowriteDisablerHook: () => null,
    createWriteExistingFileGuardHook: () => null,
  };
});

mock.module("./features/context-injector", () => ({
  contextCollector: {},
  createContextInjectorMessagesTransformHook: () => null,
}));

mock.module("./shared/agent-variant", () => ({
  applyAgentVariant: () => {},
  resolveAgentVariant: () => undefined,
  resolveVariantForModel: () => undefined,
}));

mock.module("./shared/first-message-variant", () => ({
  createFirstMessageVariantGate: () => ({
    shouldOverride: () => false,
    markApplied: () => {},
    markSessionCreated: () => {},
    clear: () => {},
  }),
}));

mock.module("./features/opencode-skill-loader", () => ({
  discoverUserClaudeSkills: async () => [],
  discoverProjectClaudeSkills: async () => [],
  discoverOpencodeGlobalSkills: async () => [],
  discoverOpencodeProjectSkills: async () => [],
  mergeSkills: (...skills: unknown[][]) => skills.flat(),
}));

mock.module("./features/builtin-skills", () => ({
  createBuiltinSkills: () => [],
}));

mock.module("./features/claude-code-mcp-loader", () => ({
  getSystemMcpServerNames: () => new Set<string>(),
}));

mock.module("./features/claude-code-session-state", () => ({
  setMainSession: () => {},
  getMainSessionID: () => undefined,
  setSessionAgent: () => {},
  updateSessionAgent: () => {},
  clearSessionAgent: () => {},
}));

mock.module("./features/background-agent", () => ({
  BackgroundManager: class BackgroundManager {
    constructor(..._args: unknown[]) {}
  },
}));

mock.module("./features/skill-mcp-manager", () => ({
  SkillMcpManager: class SkillMcpManager {
    disconnectSession = async () => {};
  },
}));

mock.module("./features/task-toast-manager", () => ({
  initTaskToastManager: () => {},
}));

mock.module("./features/tmux-subagent", () => ({
  TmuxSessionManager: class TmuxSessionManager {
    constructor(..._args: unknown[]) {}
    cleanup = async () => {};
    onSessionCreated = async () => {};
    onSessionDeleted = async () => {};
  },
}));

mock.module("./features/boulder-state", () => ({
  clearBoulderState: () => {},
}));

mock.module("./plugin-state", () => ({
  createModelCacheState: () => ({}),
}));

mock.module("./plugin-handlers", () => ({
  createConfigHandler: () => ({}),
}));

mock.module("./tools", () => ({
  builtinTools: {
    foo: DUMMY_TOOL,
    bar: DUMMY_TOOL,
  },
  createCallOmoAgent: () => DUMMY_TOOL,
  createBackgroundTools: () => ({
    background_output: DUMMY_TOOL,
  }),
  createLookAt: () => DUMMY_TOOL,
  createSkillTool: () => DUMMY_TOOL,
  createSkillMcpTool: () => DUMMY_TOOL,
  createSlashcommandTool: () => DUMMY_TOOL,
  discoverCommandsSync: () => [],
  sessionExists: () => false,
  createDelegateTask: () => DUMMY_TOOL,
  interactive_bash: DUMMY_TOOL,
  startTmuxCheck: () => {},
  lspManager: {
    cleanupTempDirectoryClients: async () => {},
  },
  createTaskCreateTool: () => DUMMY_TOOL,
  createTaskGetTool: () => DUMMY_TOOL,
  createTaskList: () => DUMMY_TOOL,
  createTaskUpdateTool: () => DUMMY_TOOL,
}));

const { default: OhMyOpenCodePlugin } = await import("./index");

describe("disabled_tools config", () => {
  beforeEach(() => {
    currentConfig = {
      experimental: { task_system: false },
    };
  });

  test("returns all tools when disabled_tools is unset", async () => {
    //#given
    const ctx = {
      directory: "/tmp/omo-test",
      client: {},
    } as PluginInput;

    //#when
    const plugin = await OhMyOpenCodePlugin(ctx);
    const toolNames = Object.keys(plugin.tool).sort();

    //#then
    expect(toolNames).toEqual(
      [
        "background_output",
        "bar",
        "call_omo_agent",
        "delegate_task",
        "foo",
        "interactive_bash",
        "look_at",
        "skill",
        "skill_mcp",
        "slashcommand",
      ].sort(),
    );
  });

  test("filters out tools listed in disabled_tools", async () => {
    //#given
    currentConfig = {
      experimental: { task_system: false },
      disabled_tools: ["call_omo_agent", "delegate_task"],
    };

    const ctx = {
      directory: "/tmp/omo-test",
      client: {},
    } as PluginInput;

    //#when
    const plugin = await OhMyOpenCodePlugin(ctx);
    const toolNames = Object.keys(plugin.tool);

    //#then
    expect(toolNames).not.toContain("call_omo_agent");
    expect(toolNames).not.toContain("delegate_task");
    expect(toolNames).toContain("foo");
    expect(toolNames).toContain("background_output");
  });

  test("matches tool names exactly", async () => {
    //#given
    currentConfig = {
      experimental: { task_system: false },
      disabled_tools: ["call"],
    };

    const ctx = {
      directory: "/tmp/omo-test",
      client: {},
    } as PluginInput;

    //#when
    const plugin = await OhMyOpenCodePlugin(ctx);
    const toolNames = Object.keys(plugin.tool);

    //#then
    expect(toolNames).toContain("call_omo_agent");
  });
});
