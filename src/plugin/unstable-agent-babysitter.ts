import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext } from "./types"

import { createUnstableAgentBabysitterHook } from "../hooks"
import type { BackgroundManager } from "../features/background-agent"
import { promptAsyncAfterSessionIdle } from "../hooks/shared/prompt-async-gate"

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
          status: async () => ctx.client.session.status(),
          prompt: async (promptArgs) => {
            const promptResult = await promptAsyncAfterSessionIdle({
              client: ctx.client,
              sessionID: promptArgs.path.id,
              source: "unstable-agent-babysitter",
              input: promptArgs,
            })
            if (promptResult.status === "failed") {
              throw promptResult.error
            }
          },
          promptAsync: async (promptArgs) => {
            const promptResult = await promptAsyncAfterSessionIdle({
              client: ctx.client,
              sessionID: promptArgs.path.id,
              source: "unstable-agent-babysitter",
              input: promptArgs,
            })
            if (promptResult.status === "failed") {
              throw promptResult.error
            }
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
