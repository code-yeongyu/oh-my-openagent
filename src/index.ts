import type { Plugin } from "@opencode-ai/plugin";
import { createBuiltinAgents } from "./agents";
import {
  createTodoContinuationEnforcer,
  createContextWindowMonitorHook,
  createSessionRecoveryHook,
  createCommentCheckerHooks,
  createGrepOutputTruncatorHook,
  createDirectoryAgentsInjectorHook,
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

function loadPluginConfig(directory: string): OhMyOpenCodeConfig {
  const configPaths = [
    path.join(directory, "oh-my-opencode.json"),
    path.join(directory, ".oh-my-opencode.json"),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf-8");
        const rawConfig = JSON.parse(content);
        const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig);

        if (!result.success) {
          log(`Config validation error in ${configPath}:`, result.error.issues);
          return {};
        }

        return result.data;
      }
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  return {};
}

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  const pluginConfig = loadPluginConfig(ctx.directory);

  const todoContinuationEnforcer = createTodoContinuationEnforcer(ctx);
  const contextWindowMonitor = createContextWindowMonitorHook(ctx);
  const sessionRecovery = createSessionRecoveryHook(ctx);
  const commentChecker = createCommentCheckerHooks();
  const grepOutputTruncator = createGrepOutputTruncatorHook(ctx);
  const directoryAgentsInjector = createDirectoryAgentsInjectorHook(ctx);
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
