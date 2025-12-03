import type { Plugin } from "@opencode-ai/plugin"
import { builtinAgents } from "./agents"
import { createTodoContinuationEnforcer } from "./hooks"

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  const todoContinuationEnforcer = createTodoContinuationEnforcer(ctx)

  return {
    config: async (config) => {
      config.agent = {
        ...config.agent,
        ...builtinAgents,
      }
    },

    event: todoContinuationEnforcer,
  }
}

export default OhMyOpenCodePlugin
