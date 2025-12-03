import type { Plugin } from "@opencode-ai/plugin"
import { builtinAgents } from "./agents"
import { createTodoContinuationEnforcer, createContextWindowMonitorHook } from "./hooks"

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  const todoContinuationEnforcer = createTodoContinuationEnforcer(ctx)
  const contextWindowMonitor = createContextWindowMonitorHook(ctx)

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
    },

    "tool.execute.after": contextWindowMonitor["tool.execute.after"],
  }
}

export default OhMyOpenCodePlugin
