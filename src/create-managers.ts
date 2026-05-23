import type { OhMyOpenCodeConfig } from "./config"
import type { LoadedSkill } from "./features/opencode-skill-loader/types"
import type { ModelCacheState } from "./plugin-state"
import type { PluginContext, TmuxConfig } from "./plugin/types"

import type { SubagentSessionCreatedEvent } from "./features/background-agent"
import { BackgroundManager } from "./features/background-agent"
import { SkillMcpManager } from "./features/skill-mcp-manager"
import { cleanupSessionTeamRuns } from "./features/team-mode/team-runtime/session-cleanup"
import { createModelFallbackControllerAccessor } from "./hooks/model-fallback"
import { initTaskToastManager } from "./features/task-toast-manager"
import { TmuxSessionManager } from "./features/tmux-subagent"
import * as openclawRuntimeDispatch from "./openclaw/runtime-dispatch"
import { registerManagerForCleanup } from "./features/background-agent/process-cleanup"
import { createConfigHandler } from "./plugin-handlers"
import { log } from "./shared"
import { markServerRunningInProcess } from "./shared/tmux/tmux-utils/server-health"
import type { ModelFallbackControllerAccessor } from "./hooks/model-fallback"

type CreateManagersDeps = {
  BackgroundManagerClass: typeof BackgroundManager
  SkillMcpManagerClass: typeof SkillMcpManager
  TmuxSessionManagerClass: typeof TmuxSessionManager
  initTaskToastManagerFn: typeof initTaskToastManager
  registerManagerForCleanupFn: typeof registerManagerForCleanup
  cleanupSessionTeamRunsFn: typeof cleanupSessionTeamRuns
  createConfigHandlerFn: typeof createConfigHandler
  markServerRunningInProcessFn: typeof markServerRunningInProcess
}

const defaultCreateManagersDeps: CreateManagersDeps = {
  BackgroundManagerClass: BackgroundManager,
  SkillMcpManagerClass: SkillMcpManager,
  TmuxSessionManagerClass: TmuxSessionManager,
  initTaskToastManagerFn: initTaskToastManager,
  registerManagerForCleanupFn: registerManagerForCleanup,
  cleanupSessionTeamRunsFn: cleanupSessionTeamRuns,
  createConfigHandlerFn: createConfigHandler,
  markServerRunningInProcessFn: markServerRunningInProcess,
}

export type Managers = {
  tmuxSessionManager: TmuxSessionManager
  backgroundManager: BackgroundManager
  skillMcpManager: SkillMcpManager
  configHandler: ReturnType<typeof createConfigHandler>
  modelFallbackControllerAccessor: ModelFallbackControllerAccessor
}

export function createManagers(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  tmuxConfig: TmuxConfig
  modelCacheState: ModelCacheState
  backgroundNotificationHookEnabled: boolean
  /**
   * Late-bound accessor for the live skill-context merged-skills array. See
   * `ConfigHandlerDeps.getMergedSkillsRef` for the full reasoning; this slot
   * is what `createPluginModule` wires up after `createTools` has produced
   * the array, so the config hook can hand sibling plugins' skills back to
   * the runtime `skill` tool.
   */
  getMergedSkillsRef?: () => LoadedSkill[] | undefined
  deps?: Partial<CreateManagersDeps>
}): Managers {
  const { ctx, pluginConfig, tmuxConfig, modelCacheState, backgroundNotificationHookEnabled } = args
  const deps = { ...defaultCreateManagersDeps, ...args.deps }

  // Only mark the server as in-process when the SDK actually exposes a
  // serverUrl. `tmuxConfig.enabled` alone is not proof of a running server —
  // a vanilla `opencode` session (no `opencode serve`/`opencode web`) leaves
  // `ctx.serverUrl` undefined, and marking it running would make
  // `isServerRunning` short-circuit to true. That bypasses the guard in
  // `createTeamLayout` and lets it spawn tmux panes whose `opencode attach`
  // command then fails because nothing is actually listening on the
  // fallback port (issue #3894).
  if (tmuxConfig.enabled && ctx.serverUrl) {
    deps.markServerRunningInProcessFn()
  }
  const tmuxSessionManager = new deps.TmuxSessionManagerClass(ctx, tmuxConfig)
  const modelFallbackControllerAccessor = createModelFallbackControllerAccessor()
  let backgroundManager: BackgroundManager | undefined

  const cleanupTeamModeRuns = async (): Promise<void> => {
    if (!pluginConfig.team_mode?.enabled) return
    const report = await deps.cleanupSessionTeamRunsFn({
      config: pluginConfig.team_mode,
      tmuxMgr: tmuxSessionManager,
      bgMgr: backgroundManager,
    })
    if (report.cleanedTeamRunIds.length > 0 || report.errors.length > 0) {
      log("[create-managers] team-mode session cleanup complete", report)
    }
  }

  deps.registerManagerForCleanupFn({
    shutdown: async () => {
      await cleanupTeamModeRuns().catch((error) => {
        log("[create-managers] team-mode cleanup error during process shutdown:", error)
      })
      await tmuxSessionManager.cleanup().catch((error) => {
        log("[create-managers] tmux cleanup error during process shutdown:", error)
      })
    },
  })

  backgroundManager = new deps.BackgroundManagerClass({
    pluginContext: ctx,
    config: pluginConfig.background_task,
    tmuxConfig,
    onSubagentSessionCreated: async (event: SubagentSessionCreatedEvent) => {
        log("[create-managers] onSubagentSessionCreated callback received", {
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

        if (pluginConfig.openclaw) {
          await openclawRuntimeDispatch.dispatchOpenClawEvent({
            config: pluginConfig.openclaw,
            rawEvent: "session.created",
            context: {
              sessionId: event.sessionID,
              projectPath: ctx.directory,
              tmuxPaneId: tmuxSessionManager.getTrackedPaneId?.(event.sessionID) ?? process.env.TMUX_PANE,
            },
          })
        }

        log("[create-managers] onSubagentSessionCreated callback completed")
    },
    onShutdown: async () => {
      await cleanupTeamModeRuns().catch((error) => {
        log("[create-managers] team-mode cleanup error during shutdown:", error)
      })
      await tmuxSessionManager.cleanup().catch((error) => {
        log("[create-managers] tmux cleanup error during shutdown:", error)
      })
    },
    enableParentSessionNotifications: backgroundNotificationHookEnabled,
    modelFallbackControllerAccessor,
  })

  deps.initTaskToastManagerFn(ctx.client)

  const skillMcpManager = new deps.SkillMcpManagerClass()

  const configHandler = deps.createConfigHandlerFn({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
    modelCacheState,
    getMergedSkillsRef: args.getMergedSkillsRef,
  })
  return {
    tmuxSessionManager,
    backgroundManager,
    skillMcpManager,
    configHandler,
    modelFallbackControllerAccessor,
  }
}
