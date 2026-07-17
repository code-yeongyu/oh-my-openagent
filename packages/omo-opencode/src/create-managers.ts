import type { OhMyOpenCodeConfig } from "./config"
import type { ModelCacheState } from "./plugin-state"
import type { PluginContext, TmuxConfig } from "./plugin/types"

import type { SubagentSessionCreatedEvent } from "./features/background-agent"
import { BackgroundManager } from "./features/background-agent"
import type { MonitorManager } from "./features/monitor"
import { createMonitorManager } from "./features/monitor"
import { SkillMcpManager } from "./features/skill-mcp-manager"
import { cleanupSessionTeamRuns } from "./features/team-mode/team-runtime/session-cleanup"
import { lookupTeamSession } from "./features/team-mode/team-session-registry"
import { TuiStateMirror } from "./features/tui-sidebar/mirror-manager"
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
  TuiStateMirrorClass: typeof TuiStateMirror
  createMonitorManagerFn: typeof createMonitorManager
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
  TuiStateMirrorClass: TuiStateMirror,
  createMonitorManagerFn: createMonitorManager,
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
  tuiStateMirror?: TuiStateMirror
  monitorManager?: MonitorManager
}

export function createManagers(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  tmuxConfig: TmuxConfig
  modelCacheState: ModelCacheState
  backgroundNotificationHookEnabled: boolean
  runtimeSkillSourceUrl?: string
  deps?: Partial<CreateManagersDeps>
}): Managers {
  const { ctx, pluginConfig, tmuxConfig, modelCacheState, backgroundNotificationHookEnabled, runtimeSkillSourceUrl } = args
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
  const tmuxSessionManager = new deps.TmuxSessionManagerClass(ctx, tmuxConfig, undefined, {
    // Team-mode members get their tmux panes from team-layout-tmux, which
    // owns the lifecycle via runtimeState.tmuxLayout. Telling the subagent
    // manager to ignore those sessions prevents the polling loop from racing
    // pane closes against team-layout and stops them from being surfaced
    // twice in the subagent panel.
    shouldSkipSession: (sessionId) => lookupTeamSession(sessionId) !== undefined,
  })
  const modelFallbackControllerAccessor = createModelFallbackControllerAccessor()
  let backgroundManager: BackgroundManager | undefined
  let tuiStateMirror: TuiStateMirror | undefined

  const monitorManager = pluginConfig.monitor?.enabled
    ? deps.createMonitorManagerFn({
      pluginContext: { client: ctx.client, directory: ctx.directory },
      config: pluginConfig.monitor,
    })
    : undefined

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
      tuiStateMirror?.stop()
      await cleanupTeamModeRuns().catch((error) => {
        log("[create-managers] team-mode cleanup error during process shutdown:", error)
      })
      await tmuxSessionManager.cleanup().catch((error) => {
        log("[create-managers] tmux cleanup error during process shutdown:", error)
      })
      await monitorManager?.shutdown().catch((error) => {
        log("[create-managers] monitor cleanup error during process shutdown:", error)
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

        if (event.signal.aborted) return

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

        if (event.signal.aborted) {
          await tmuxSessionManager.onSessionDeleted({ sessionID: event.sessionID })
          return
        }

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
    onSubagentSessionDeleted: async (event: { sessionID: string }) => {
      log("[create-managers] onSubagentSessionDeleted callback received", {
        sessionID: event.sessionID,
      })

      await tmuxSessionManager.onSessionDeleted(event).catch((error) => {
        log("[create-managers] onSubagentSessionDeleted callback error:", {
          sessionID: event.sessionID,
          error: String(error),
        })
      })

      log("[create-managers] onSubagentSessionDeleted callback completed")
    },
    onShutdown: async () => {
      tuiStateMirror?.stop()
      await cleanupTeamModeRuns().catch((error) => {
        log("[create-managers] team-mode cleanup error during shutdown:", error)
      })
      await tmuxSessionManager.cleanup().catch((error) => {
        log("[create-managers] tmux cleanup error during shutdown:", error)
      })
      await monitorManager?.shutdown().catch((error) => {
        log("[create-managers] monitor cleanup error during shutdown:", error)
      })
    },
    enableParentSessionNotifications: backgroundNotificationHookEnabled,
    modelFallbackControllerAccessor,
  })

  if (pluginConfig.tui?.sidebar?.enabled !== false) {
    tuiStateMirror = new deps.TuiStateMirrorClass({
      client: ctx.client,
      projectDir: ctx.directory,
      backgroundManager,
    })
    tuiStateMirror.start()
  }

  deps.initTaskToastManagerFn(ctx.client)

  const skillMcpManager = new deps.SkillMcpManagerClass()

  const configHandler = deps.createConfigHandlerFn({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
    modelCacheState,
    runtimeSkillSourceUrl,
  })
  return {
    tmuxSessionManager,
    backgroundManager,
    skillMcpManager,
    configHandler,
    modelFallbackControllerAccessor,
    tuiStateMirror,
    monitorManager,
  }
}
