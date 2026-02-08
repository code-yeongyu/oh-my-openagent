import type { TmuxConfig } from "../../config/schema"
import type { TrackedSession, CapacityConfig } from "./types"
import { log } from "../../shared"
import { queryWindowState } from "./pane-state-querier"
import { decideSpawnActions, type SessionMapping } from "./decision-engine"
import { executeActions } from "./action-executor"
import { TmuxPollingManager } from "./polling-manager"

interface SessionCreatedEvent {
  type: string
  properties?: { info?: { id?: string; parentID?: string; title?: string } }
}

export interface TmuxUtilDeps {
  isInsideTmux: () => boolean
  getCurrentPaneId: () => string | undefined
}

export class SessionSpawner {
  constructor(
    private tmuxConfig: TmuxConfig,
    private deps: TmuxUtilDeps,
    private sessions: Map<string, TrackedSession>,
    private pendingSessions: Set<string>,
    private sourcePaneId: string | undefined,
    private getCapacityConfig: () => CapacityConfig,
    private getSessionMappings: () => SessionMapping[],
    private waitForSessionReady: (sessionId: string) => Promise<boolean>,
    private pollingManager: TmuxPollingManager,
    private serverUrl: string
  ) {}

  private isEnabled(): boolean {
    return this.tmuxConfig.enabled && this.deps.isInsideTmux()
  }

  async onSessionCreated(event: SessionCreatedEvent): Promise<void> {
    const enabled = this.isEnabled()
    log("[tmux-session-manager] onSessionCreated called", {
      enabled,
      tmuxConfigEnabled: this.tmuxConfig.enabled,
      isInsideTmux: this.deps.isInsideTmux(),
      eventType: event.type,
      infoId: event.properties?.info?.id,
      infoParentID: event.properties?.info?.parentID,
    })

    if (!enabled) return
    if (event.type !== "session.created") return

    const info = event.properties?.info
    if (!info?.id || !info?.parentID) return

    const sessionId = info.id
    const title = info.title ?? "Subagent"

    if (this.sessions.has(sessionId) || this.pendingSessions.has(sessionId)) {
      log("[tmux-session-manager] session already tracked or pending", { sessionId })
      return
    }

    if (!this.sourcePaneId) {
      log("[tmux-session-manager] no source pane id")
      return
    }

    this.pendingSessions.add(sessionId)

    try {
      const state = await queryWindowState(this.sourcePaneId)
      if (!state) {
        log("[tmux-session-manager] failed to query window state")
        return
      }

      log("[tmux-session-manager] window state queried", {
        windowWidth: state.windowWidth,
        mainPane: state.mainPane?.paneId,
        agentPaneCount: state.agentPanes.length,
        agentPanes: state.agentPanes.map((p) => p.paneId),
      })

      const decision = decideSpawnActions(
        state,
        sessionId,
        title,
        this.getCapacityConfig(),
        this.getSessionMappings()
      )

      log("[tmux-session-manager] spawn decision", {
        canSpawn: decision.canSpawn,
        reason: decision.reason,
        actionCount: decision.actions.length,
        actions: decision.actions.map((a) => {
          if (a.type === "close") return { type: "close", paneId: a.paneId }
          if (a.type === "replace") return { type: "replace", paneId: a.paneId, newSessionId: a.newSessionId }
          return { type: "spawn", sessionId: a.sessionId }
        }),
      })

      if (!decision.canSpawn) {
        log("[tmux-session-manager] cannot spawn", { reason: decision.reason })
        return
      }

      const result = await executeActions(
        decision.actions,
        { config: this.tmuxConfig, serverUrl: this.serverUrl, windowState: state }
      )

      for (const { action, result: actionResult } of result.results) {
        if (action.type === "close" && actionResult.success) {
          this.sessions.delete(action.sessionId)
          log("[tmux-session-manager] removed closed session from cache", {
            sessionId: action.sessionId,
          })
        }
        if (action.type === "replace" && actionResult.success) {
          this.sessions.delete(action.oldSessionId)
          log("[tmux-session-manager] removed replaced session from cache", {
            oldSessionId: action.oldSessionId,
            newSessionId: action.newSessionId,
          })
        }
      }

      if (result.success && result.spawnedPaneId) {
        const sessionReady = await this.waitForSessionReady(sessionId)
        
        if (!sessionReady) {
          log("[tmux-session-manager] session not ready after timeout, tracking anyway", {
            sessionId,
            paneId: result.spawnedPaneId,
          })
        }
        
        const now = Date.now()
        this.sessions.set(sessionId, {
          sessionId,
          paneId: result.spawnedPaneId,
          description: title,
          createdAt: new Date(now),
          lastSeenAt: new Date(now),
        })
        log("[tmux-session-manager] pane spawned and tracked", {
          sessionId,
          paneId: result.spawnedPaneId,
          sessionReady,
        })
        this.pollingManager.startPolling()
      } else {
        log("[tmux-session-manager] spawn failed", {
          success: result.success,
          results: result.results.map((r) => ({
            type: r.action.type,
            success: r.result.success,
            error: r.result.error,
          })),
        })
      }
    } finally {
      this.pendingSessions.delete(sessionId)
    }
  }
}
