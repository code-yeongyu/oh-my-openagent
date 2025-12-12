import type { Plugin } from "@opencode-ai/plugin";
import { createBuiltinAgents } from "./agents";
import {
  createTodoContinuationEnforcer,
  createContextWindowMonitorHook,
  createSessionRecoveryHook,
  createCommentCheckerHooks,
  createGrepOutputTruncatorHook,
  createDirectoryAgentsInjectorHook,
  createDirectoryReadmeInjectorHook,
  createEmptyTaskResponseDetectorHook,
  createThinkModeHook,
  createClaudeCodeHooksHook,
  createAnthropicAutoCompactHook,
  createRulesInjectorHook,
  createBackgroundNotificationHook,
} from "./hooks";
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
import { builtinTools, createOmoTask, createBackgroundTools } from "./tools";
import { BackgroundManager } from "./features/background-agent";
import { createBuiltinMcps } from "./mcp";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "./config";
import { log } from "./shared/logger";
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

function loadConfigFromPath(configPath: string): OhMyOpenCodeConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const rawConfig = JSON.parse(content);
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
    agents:
      override.agents !== undefined
        ? { ...(base.agents ?? {}), ...override.agents }
        : base.agents,
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
    claude_code:
      override.claude_code !== undefined || base.claude_code !== undefined
        ? { ...(base.claude_code ?? {}), ...(override.claude_code ?? {}) }
        : undefined,
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
    claude_code: config.claude_code,
  });
  return config;
}

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  const pluginConfig = loadPluginConfig(ctx.directory);

  const todoContinuationEnforcer = createTodoContinuationEnforcer(ctx);
  const contextWindowMonitor = createContextWindowMonitorHook(ctx);
  const sessionRecovery = createSessionRecoveryHook(ctx);
  const commentChecker = createCommentCheckerHooks();
  const grepOutputTruncator = createGrepOutputTruncatorHook(ctx);
  const directoryAgentsInjector = createDirectoryAgentsInjectorHook(ctx);
  const directoryReadmeInjector = createDirectoryReadmeInjectorHook(ctx);
  const emptyTaskResponseDetector = createEmptyTaskResponseDetectorHook(ctx);
  const thinkMode = createThinkModeHook();
  const claudeCodeHooks = createClaudeCodeHooksHook(ctx, {
    disabledHooks: (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
  });
  const anthropicAutoCompact = createAnthropicAutoCompactHook(ctx);
  const rulesInjector = createRulesInjectorHook(ctx);

  updateTerminalTitle({ sessionId: "main" });

  const backgroundManager = new BackgroundManager(ctx);

  const backgroundNotificationHook = createBackgroundNotificationHook(backgroundManager);
  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const omoTask = createOmoTask(ctx);

  return {
    tool: {
      ...builtinTools,
      ...backgroundTools,
      omo_task: omoTask,
    },

    "chat.message": async (input, output) => {
      await claudeCodeHooks["chat.message"]?.(input, output);
      await backgroundNotificationHook["chat.message"](input, output);
    },

    config: async (config) => {
      const builtinAgents = createBuiltinAgents(
        pluginConfig.disabled_agents,
        pluginConfig.agents,
      );

      const userAgents = (pluginConfig.claude_code?.agents ?? true) ? loadUserAgents() : {};
      const projectAgents = (pluginConfig.claude_code?.agents ?? true) ? loadProjectAgents() : {};

      config.agent = {
        ...builtinAgents,
        ...userAgents,
        ...projectAgents,
        ...config.agent,
      };
      config.tools = {
        ...config.tools,
      };

      if (config.agent.explore) {
        config.agent.explore.tools = {
          ...config.agent.explore.tools,
          omo_task: false,
        };
      }
      if (config.agent.librarian) {
        config.agent.librarian.tools = {
          ...config.agent.librarian.tools,
          omo_task: false,
        };
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
      await claudeCodeHooks.event(input);
      await backgroundNotificationHook.event(input);
      await todoContinuationEnforcer(input);
      await contextWindowMonitor.event(input);
      await directoryAgentsInjector.event(input);
      await directoryReadmeInjector.event(input);
      await rulesInjector.event(input);
      await thinkMode.event(input);
      await anthropicAutoCompact.event(input);

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
        if (sessionInfo?.id === getMainSessionID()) {
          setMainSession(undefined);
          setCurrentSession(undefined, undefined);
          updateTerminalTitle({
            sessionId: "main",
            status: "idle",
          });
        }
      }

      if (event.type === "session.error") {
        const sessionID = props?.sessionID as string | undefined;
        const error = props?.error;

        if (sessionRecovery.isRecoverableError(error)) {
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
    },

    "tool.execute.before": async (input, output) => {
      await claudeCodeHooks["tool.execute.before"](input, output);
      await commentChecker["tool.execute.before"](input, output);

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
      await grepOutputTruncator["tool.execute.after"](input, output);
      await contextWindowMonitor["tool.execute.after"](input, output);
      await commentChecker["tool.execute.after"](input, output);
      await directoryAgentsInjector["tool.execute.after"](input, output);
      await directoryReadmeInjector["tool.execute.after"](input, output);
      await rulesInjector["tool.execute.after"](input, output);
      await emptyTaskResponseDetector["tool.execute.after"](input, output);

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
} from "./config";
