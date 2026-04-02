import type { OhMyOpenCodeConfig } from "./config"
import type { ModelCacheState } from "./plugin-state"
import type { PluginContext, TmuxConfig } from "./plugin/types"

import type { SubagentSessionCreatedEvent } from "./features/background-agent"
import { BackgroundManager } from "./features/background-agent"
import { SkillMcpManager } from "./features/skill-mcp-manager"
import { initTaskToastManager } from "./features/task-toast-manager"
import { TmuxSessionManager } from "./features/tmux-subagent"
import { registerManagerForCleanup } from "./features/background-agent/process-cleanup"
import { createConfigHandler } from "./plugin-handlers"
import { log } from "./shared"
import { markServerRunningInProcess } from "./shared/tmux/tmux-utils/server-health"
import { detectMultiplexer, createMultiplexer } from "./shared/terminal-multiplexer/detection"

export type Managers = {
  tmuxSessionManager: TmuxSessionManager
  backgroundManager: BackgroundManager
  skillMcpManager: SkillMcpManager
  configHandler: ReturnType<typeof createConfigHandler>
}

export async function createManagers(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  tmuxConfig: TmuxConfig
  modelCacheState: ModelCacheState
  backgroundNotificationHookEnabled: boolean
}): Promise<Managers> {
  const { ctx, pluginConfig, tmuxConfig, modelCacheState, backgroundNotificationHookEnabled } = args

  markServerRunningInProcess()

  const terminalConfig = pluginConfig.terminal
  const provider = terminalConfig?.provider ?? "auto"
  let adapter = null

  if (provider === "zellij" || (provider === "auto" && await detectMultiplexer() === "zellij")) {
    adapter = createMultiplexer("zellij")
    const zellijSessionName = process.env.ZELLIJ_SESSION_NAME ?? (process.env.ZELLIJ ? "default" : undefined)
    if (zellijSessionName && adapter.setSessionID) {
      await adapter.setSessionID(zellijSessionName)
    }
    log("[create-managers] zellij adapter created", { zellijSessionName })
  }

  const tmuxSessionManager = new TmuxSessionManager(ctx, adapter, tmuxConfig)

  registerManagerForCleanup({
    shutdown: async () => {
      await tmuxSessionManager.cleanup().catch((error) => {
        log("[create-managers] tmux cleanup error during process shutdown:", error)
      })
    },
  })

  const backgroundManager = new BackgroundManager(
    ctx,
    pluginConfig.background_task,
    {
      tmuxConfig,
		onSubagentSessionCreated: async (event: SubagentSessionCreatedEvent) => {
			log("[index] onSubagentSessionCreated callback received", {
				sessionID: event.sessionID,
				parentID: event.parentID,
          title: event.title,
        })

        await tmuxSessionManager.onSessionCreated({
          type: "session.created",
          properties: {
            info: {
              id: event.sessionID,
              parentID: event.parentID,
              title: event.title,
            },
          },
        })

        log("[index] onSubagentSessionCreated callback completed")
      },
      onShutdown: async () => {
        await tmuxSessionManager.cleanup().catch((error) => {
          log("[index] tmux cleanup error during shutdown:", error)
        })
      },
      enableParentSessionNotifications: backgroundNotificationHookEnabled,
    },
  )

  initTaskToastManager(ctx.client)

  const skillMcpManager = new SkillMcpManager()

  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
    modelCacheState,
  })

  return {
    tmuxSessionManager,
    backgroundManager,
    skillMcpManager,
    configHandler,
  }
}
