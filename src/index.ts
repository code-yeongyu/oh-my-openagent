import type { Plugin } from "@opencode-ai/plugin"
import { builtinAgents } from "./agents"
import { createTodoContinuationEnforcer, createContextWindowMonitorHook } from "./hooks"
import { updateTerminalTitle } from "./features/terminal"

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  const todoContinuationEnforcer = createTodoContinuationEnforcer(ctx)
  const contextWindowMonitor = createContextWindowMonitorHook(ctx)

  updateTerminalTitle({ sessionId: "main" })

  let mainSessionID: string | undefined
  let currentSessionID: string | undefined
  let currentSessionTitle: string | undefined

  return {
    config: async (config) => {
      config.agent = {
        ...config.agent,
        ...builtinAgents,
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
