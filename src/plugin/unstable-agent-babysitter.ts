import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext } from "./types"

import { createUnstableAgentBabysitterHook } from "../hooks"
import type { BackgroundManager } from "../features/background-agent"

export function createUnstableAgentBabysitter(args: {
  ctx: PluginContext
  backgroundManager: BackgroundManager
  pluginConfig: OhMyOpenCodeConfig
}) {
  const { ctx, backgroundManager, pluginConfig } = args

  return createUnstableAgentBabysitterHook(
    {
      directory: ctx.directory,
      client: {
        session: {
          messages: async ({ path }) => {
            const result = await ctx.client.session.messages({ path })
            if (Array.isArray(result)) return result
            if (typeof result === "object" && result !== null) {
              return result
            }
            return []
          },
          prompt: async (promptArgs) => {
            await ctx.client.session.promptAsync(promptArgs)
          },
          promptAsync: async (promptArgs) => {
            await ctx.client.session.promptAsync(promptArgs)
          },
        },
      },
    },
    {
      backgroundManager,
      config: pluginConfig.babysitting,
    },
  )
}
