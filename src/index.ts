import type { Plugin } from "@opencode-ai/plugin"
import { createBuiltinAgents, type AgentName, type AgentOverrides } from "./agents"
import { createTodoContinuationEnforcer, createContextWindowMonitorHook, createSessionRecoveryHook } from "./hooks"
import { updateTerminalTitle } from "./features/terminal"
import { builtinTools } from "./tools"
import { createBuiltinMcps, type McpName } from "./mcp"
import * as fs from "fs"
import * as path from "path"

interface OhMyOpenCodeConfig {
  disabled_mcps?: McpName[]
  disabled_agents?: AgentName[]
  agents?: AgentOverrides
}

function loadPluginConfig(directory: string): OhMyOpenCodeConfig {
  const configPaths = [
    path.join(directory, "oh-my-opencode.json"),
    path.join(directory, ".oh-my-opencode.json"),
  ]

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf-8")
        return JSON.parse(content) as OhMyOpenCodeConfig
      }
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  return {}
}

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  const todoContinuationEnforcer = createTodoContinuationEnforcer(ctx)
  const contextWindowMonitor = createContextWindowMonitorHook(ctx)
  const sessionRecovery = createSessionRecoveryHook(ctx)

  updateTerminalTitle({ sessionId: "main" })

  const pluginConfig = loadPluginConfig(ctx.directory)

  let mainSessionID: string | undefined
  let currentSessionID: string | undefined
  let currentSessionTitle: string | undefined

  return {
    tool: builtinTools,

    config: async (config) => {
      const agents = createBuiltinAgents(
        pluginConfig.disabled_agents,
        pluginConfig.agents
      )

      config.agent = {
        ...config.agent,
        ...agents,
      }
      config.tools = {
        ...config.tools,
        grep: false,
      }
      config.mcp = {
        ...config.mcp,
        ...createBuiltinMcps(pluginConfig.disabled_mcps),
      }
    },

    event: async (input) => {
      await todoContinuationEnforcer(input)
      await contextWindowMonitor.event(input)

      const { event } = input
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "session.created") {
        const sessionInfo = props?.info as { id?: string; title?: string; parentID?: string } | undefined
        if (!sessionInfo?.parentID) {
          mainSessionID = sessionInfo?.id
          currentSessionID = sessionInfo?.id
          currentSessionTitle = sessionInfo?.title
          updateTerminalTitle({
            sessionId: currentSessionID || "main",
            status: "idle",
            directory: ctx.directory,
            sessionTitle: currentSessionTitle,
          })
        }
      }

      if (event.type === "session.updated") {
        const sessionInfo = props?.info as { id?: string; title?: string; parentID?: string } | undefined
        if (!sessionInfo?.parentID) {
          currentSessionID = sessionInfo?.id
          currentSessionTitle = sessionInfo?.title
          updateTerminalTitle({
            sessionId: currentSessionID || "main",
            status: "processing",
            directory: ctx.directory,
            sessionTitle: currentSessionTitle,
          })
        }
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id === mainSessionID) {
          mainSessionID = undefined
          currentSessionID = undefined
          currentSessionTitle = undefined
          updateTerminalTitle({
            sessionId: "main",
            status: "idle",
          })
        }
      }

      if (event.type === "session.error") {
        const sessionID = props?.sessionID as string | undefined
        const error = props?.error

        if (sessionRecovery.isRecoverableError(error)) {
          const messageInfo = {
            id: props?.messageID as string | undefined,
            role: "assistant" as const,
            sessionID,
            error,
          }
          await sessionRecovery.handleSessionRecovery(messageInfo)
        }

        if (sessionID && sessionID === mainSessionID) {
          updateTerminalTitle({
            sessionId: sessionID,
            status: "error",
            directory: ctx.directory,
            sessionTitle: currentSessionTitle,
          })
        }
      }

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (sessionID && sessionID === mainSessionID) {
          updateTerminalTitle({
            sessionId: sessionID,
            status: "idle",
            directory: ctx.directory,
            sessionTitle: currentSessionTitle,
          })
        }
      }
    },

    "tool.execute.before": async (input, _output) => {
      if (input.sessionID === mainSessionID) {
        updateTerminalTitle({
          sessionId: input.sessionID,
          status: "tool",
          currentTool: input.tool,
          directory: ctx.directory,
          sessionTitle: currentSessionTitle,
        })
      }
    },

    "tool.execute.after": async (input, output) => {
      await contextWindowMonitor["tool.execute.after"](input, output)

      if (input.sessionID === mainSessionID) {
        updateTerminalTitle({
          sessionId: input.sessionID,
          status: "idle",
          directory: ctx.directory,
          sessionTitle: currentSessionTitle,
        })
      }
    },
  }
}

export default OhMyOpenCodePlugin

export type { AgentName, AgentOverrideConfig, AgentOverrides } from "./agents"
export type { McpName } from "./mcp"
