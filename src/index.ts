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
} from "./hooks";
import { updateTerminalTitle } from "./features/terminal";
import { builtinTools } from "./tools";
import { createBuiltinMcps } from "./mcp";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "./config";
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
          console.error(
            `[oh-my-opencode] Config validation error in ${configPath}:`,
          );
          for (const issue of result.error.issues) {
            console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
          }
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
  const todoContinuationEnforcer = createTodoContinuationEnforcer(ctx);
  const contextWindowMonitor = createContextWindowMonitorHook(ctx);
  const sessionRecovery = createSessionRecoveryHook(ctx);
  const commentChecker = createCommentCheckerHooks();
  const grepOutputTruncator = createGrepOutputTruncatorHook(ctx);
  const directoryAgentsInjector = createDirectoryAgentsInjectorHook(ctx);
  const emptyTaskResponseDetector = createEmptyTaskResponseDetectorHook(ctx);

  updateTerminalTitle({ sessionId: "main" });

  const pluginConfig = loadPluginConfig(ctx.directory);

  let mainSessionID: string | undefined;
  let currentSessionID: string | undefined;
  let currentSessionTitle: string | undefined;

  return {
    tool: builtinTools,

    config: async (config) => {
      const agents = createBuiltinAgents(
        pluginConfig.disabled_agents,
        pluginConfig.agents,
      );

      config.agent = {
        ...config.agent,
        ...agents,
      };
      config.tools = {
        ...config.tools,
      };
      config.mcp = {
        ...config.mcp,
        ...createBuiltinMcps(pluginConfig.disabled_mcps),
      };
    },

    event: async (input) => {
      await todoContinuationEnforcer(input);
      await contextWindowMonitor.event(input);
      await directoryAgentsInjector.event(input);

      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.created") {
        const sessionInfo = props?.info as
          | { id?: string; title?: string; parentID?: string }
          | undefined;
        if (!sessionInfo?.parentID) {
          mainSessionID = sessionInfo?.id;
          currentSessionID = sessionInfo?.id;
          currentSessionTitle = sessionInfo?.title;
          updateTerminalTitle({
            sessionId: currentSessionID || "main",
            status: "idle",
            directory: ctx.directory,
            sessionTitle: currentSessionTitle,
          });
        }
      }

      if (event.type === "session.updated") {
        const sessionInfo = props?.info as
          | { id?: string; title?: string; parentID?: string }
          | undefined;
        if (!sessionInfo?.parentID) {
          currentSessionID = sessionInfo?.id;
          currentSessionTitle = sessionInfo?.title;
          updateTerminalTitle({
            sessionId: currentSessionID || "main",
            status: "processing",
            directory: ctx.directory,
            sessionTitle: currentSessionTitle,
          });
        }
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id === mainSessionID) {
          mainSessionID = undefined;
          currentSessionID = undefined;
          currentSessionTitle = undefined;
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

          if (recovered && sessionID && sessionID === mainSessionID) {
            await ctx.client.session
              .prompt({
                path: { id: sessionID },
                body: { parts: [{ type: "text", text: "continue" }] },
                query: { directory: ctx.directory },
              })
              .catch(() => {});
          }
        }

        if (sessionID && sessionID === mainSessionID) {
          updateTerminalTitle({
            sessionId: sessionID,
            status: "error",
            directory: ctx.directory,
            sessionTitle: currentSessionTitle,
          });
        }
      }

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined;
        if (sessionID && sessionID === mainSessionID) {
          updateTerminalTitle({
            sessionId: sessionID,
            status: "idle",
            directory: ctx.directory,
            sessionTitle: currentSessionTitle,
          });
        }
      }
    },

    "tool.execute.before": async (input, output) => {
      await commentChecker["tool.execute.before"](input, output);

      if (input.sessionID === mainSessionID) {
        updateTerminalTitle({
          sessionId: input.sessionID,
          status: "tool",
          currentTool: input.tool,
          directory: ctx.directory,
          sessionTitle: currentSessionTitle,
        });
      }
    },

    "tool.execute.after": async (input, output) => {
      await grepOutputTruncator["tool.execute.after"](input, output);
      await contextWindowMonitor["tool.execute.after"](input, output);
      await commentChecker["tool.execute.after"](input, output);
      await directoryAgentsInjector["tool.execute.after"](input, output);
      await emptyTaskResponseDetector["tool.execute.after"](input, output);

      if (input.sessionID === mainSessionID) {
        updateTerminalTitle({
          sessionId: input.sessionID,
          status: "idle",
          directory: ctx.directory,
          sessionTitle: currentSessionTitle,
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
