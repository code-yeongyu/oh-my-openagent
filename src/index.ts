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
import { builtinTools } from "./tools";
import { createBuiltinMcps } from "./mcp";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "./config";
import { log } from "./shared/logger";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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

function mergeConfigs(base: OhMyOpenCodeConfig, override: OhMyOpenCodeConfig): OhMyOpenCodeConfig {
  return {
    ...base,
    ...override,
    agents: override.agents !== undefined
      ? { ...(base.agents ?? {}), ...override.agents }
      : base.agents,
    disabled_agents: [
      ...new Set([...(base.disabled_agents ?? []), ...(override.disabled_agents ?? [])])
    ],
    disabled_mcps: [
      ...new Set([...(base.disabled_mcps ?? []), ...(override.disabled_mcps ?? [])])
    ],
  };
}

function loadPluginConfig(directory: string): OhMyOpenCodeConfig {
  // User-level config paths
  const userConfigPaths = [
    path.join(os.homedir(), ".config", "opencode", "oh-my-opencode.json"),
  ];

  // Project-level config paths (higher precedence)
  const projectConfigPaths = [
    path.join(directory, ".opencode", "oh-my-opencode.json"),
  ];

  // Load user config first
  let config: OhMyOpenCodeConfig = {};
  for (const configPath of userConfigPaths) {
    const userConfig = loadConfigFromPath(configPath);
    if (userConfig) {
      config = userConfig;
      break;
    }
  }

  // Override with project config
  for (const configPath of projectConfigPaths) {
    const projectConfig = loadConfigFromPath(configPath);
    if (projectConfig) {
      config = mergeConfigs(config, projectConfig);
      break;
    }
  }

  log("Final merged config", { agents: config.agents, disabled_agents: config.disabled_agents, disabled_mcps: config.disabled_mcps });
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
  const claudeCodeHooks = createClaudeCodeHooksHook(ctx, {});
  const anthropicAutoCompact = createAnthropicAutoCompactHook(ctx);

  updateTerminalTitle({ sessionId: "main" });

  return {
    tool: builtinTools,

    "chat.message": async (input, output) => {
      await claudeCodeHooks["chat.message"]?.(input, output)
    },

    config: async (config) => {
      const builtinAgents = createBuiltinAgents(
        pluginConfig.disabled_agents,
        pluginConfig.agents,
      );
      const userAgents = loadUserAgents();
      const projectAgents = loadProjectAgents();

      config.agent = {
        ...builtinAgents,
        ...userAgents,
        ...projectAgents,
        ...config.agent,
      };
      config.tools = {
        ...config.tools,
      };

      const mcpResult = await loadMcpConfigs();
      config.mcp = {
        ...config.mcp,
        ...createBuiltinMcps(pluginConfig.disabled_mcps),
        ...mcpResult.servers,
      };

      const userCommands = loadUserCommands();
      const opencodeGlobalCommands = loadOpencodeGlobalCommands();
      const systemCommands = config.command ?? {};
      const projectCommands = loadProjectCommands();
      const opencodeProjectCommands = loadOpencodeProjectCommands();
      const userSkills = loadUserSkillsAsCommands();
      const projectSkills = loadProjectSkillsAsCommands();

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
      await todoContinuationEnforcer(input);
      await contextWindowMonitor.event(input);
      await directoryAgentsInjector.event(input);
      await directoryReadmeInjector.event(input);
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
