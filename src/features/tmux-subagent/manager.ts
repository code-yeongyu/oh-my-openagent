import type { PluginInput } from "@opencode-ai/plugin"
import type { TmuxConfig } from "../../config/schema"
import type { TrackedSession, CapacityConfig } from "./types"
import {
  isInsideTmux as defaultIsInsideTmux,
  getCurrentPaneId as defaultGetCurrentPaneId,
  POLL_INTERVAL_BACKGROUND_MS,
  SESSION_MISSING_GRACE_MS,
  SESSION_READY_POLL_INTERVAL_MS,
  SESSION_READY_TIMEOUT_MS,
} from "../../shared/tmux"
import { log } from "../../shared"
import { queryWindowState } from "./pane-state-querier"
import { decideSpawnActions, decideCloseAction, type SessionMapping } from "./decision-engine"
import { executeActions, executeAction } from "./action-executor"

type OpencodeClient = PluginInput["client"]

interface SessionCreatedEvent {
  type: string
  properties?: { info?: { id?: string; parentID?: string; title?: string } }
}

export interface TmuxUtilDeps {
  isInsideTmux: () => boolean
  getCurrentPaneId: () => string | undefined
}

const defaultTmuxDeps: TmuxUtilDeps = {
  isInsideTmux: defaultIsInsideTmux,
  getCurrentPaneId: defaultGetCurrentPaneId,
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000

/**
 * State-first Tmux Session Manager
 * 
 * Architecture:
 * 1. QUERY: Get actual tmux pane state (source of truth)
 * 2. DECIDE: Pure function determines actions based on state
 * 3. EXECUTE: Execute actions with verification
 * 4. UPDATE: Update internal cache only after tmux confirms success
 * 
 * The internal `sessions` Map is just a cache for sessionId<->paneId mapping.
 * The REAL source of truth is always queried from tmux.
 */
export class TmuxSessionManager {
  private client: OpencodeClient
  private tmuxConfig: TmuxConfig
  private serverUrl: string
  private sourcePaneId: string | undefined
  private sessions = new Map<string, TrackedSession>()
  private pendingSessions = new Set<string>()
  private pollInterval?: ReturnType<typeof setInterval>
  private deps: TmuxUtilDeps

  constructor(ctx: PluginInput, tmuxConfig: TmuxConfig, deps: TmuxUtilDeps = defaultTmuxDeps) {
    this.client = ctx.client
    this.tmuxConfig = tmuxConfig
    this.deps = deps
    const defaultPort = process.env.OPENCODE_PORT ?? "4096"
    this.serverUrl = ctx.serverUrl?.toString() ?? `http://localhost:${defaultPort}`
    this.sourcePaneId = deps.getCurrentPaneId()

    log("[tmux-session-manager] initialized", {
      configEnabled: this.tmuxConfig.enabled,
      tmuxConfig: this.tmuxConfig,
      serverUrl: this.serverUrl,
      sourcePaneId: this.sourcePaneId,
    })
  }

  private isEnabled(): boolean {
    return this.tmuxConfig.enabled && this.deps.isInsideTmux()
  }

  private getCapacityConfig(): CapacityConfig {
    return {
      mainPaneMinWidth: this.tmuxConfig.main_pane_min_width,
      agentPaneWidth: this.tmuxConfig.agent_pane_min_width,
    }
  }

  private getSessionMappings(): SessionMapping[] {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      paneId: s.paneId,
      createdAt: s.createdAt,
    }))
  }

  private async waitForSessionReady(sessionId: string): Promise<boolean> {
    const startTime = Date.now()
    
    while (Date.now() - startTime < SESSION_READY_TIMEOUT_MS) {
      try {
        const statusResult = await this.client.session.status({ path: undefined })
        const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>
        
        if (allStatuses[sessionId]) {
          log("[tmux-session-manager] session ready", {
            sessionId,
            status: allStatuses[sessionId].type,
            waitedMs: Date.now() - startTime,
          })
          return true
        }
      } catch (err) {
        log("[tmux-session-manager] session status check error", { error: String(err) })
      }
      
      await new Promise((resolve) => setTimeout(resolve, SESSION_READY_POLL_INTERVAL_MS))
    }
    
    log("[tmux-session-manager] session ready timeout", {
      sessionId,
      timeoutMs: SESSION_READY_TIMEOUT_MS,
    })
    return false
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
        this.startPolling()
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

  async onSessionDeleted(event: { sessionID: string }): Promise<void> {
    if (!this.isEnabled()) return
    if (!this.sourcePaneId) return

    const tracked = this.sessions.get(event.sessionID)
    if (!tracked) return

    log("[tmux-session-manager] onSessionDeleted", { sessionId: event.sessionID })

    const state = await queryWindowState(this.sourcePaneId)
    if (!state) {
      this.sessions.delete(event.sessionID)
      return
    }

    const closeAction = decideCloseAction(state, event.sessionID, this.getSessionMappings())
    if (closeAction) {
      await executeAction(closeAction, { config: this.tmuxConfig, serverUrl: this.serverUrl, windowState: state })
    }

    this.sessions.delete(event.sessionID)

    if (this.sessions.size === 0) {
      this.stopPolling()
    }
  }

  private startPolling(): void {
    if (this.pollInterval) return

    this.pollInterval = setInterval(
      () => this.pollSessions(),
      POLL_INTERVAL_BACKGROUND_MS,
    )
    log("[tmux-session-manager] polling started")
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = undefined
      log("[tmux-session-manager] polling stopped")
    }
  }

  private async pollSessions(): Promise<void> {
    if (this.sessions.size === 0) {
      this.stopPolling()
      return
    }

    try {
      const statusResult = await this.client.session.status({ path: undefined })
      const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>

      log("[tmux-session-manager] pollSessions", {
        trackedSessions: Array.from(this.sessions.keys()),
        allStatusKeys: Object.keys(allStatuses),
      })

      const now = Date.now()
      const sessionsToClose: string[] = []

      for (const [sessionId, tracked] of this.sessions.entries()) {
        const status = allStatuses[sessionId]
        const isIdle = status?.type === "idle"

        if (status) {
          tracked.lastSeenAt = new Date(now)
        }

        const missingSince = !status ? now - tracked.lastSeenAt.getTime() : 0
        const missingTooLong = missingSince >= SESSION_MISSING_GRACE_MS
        const isTimedOut = now - tracked.createdAt.getTime() > SESSION_TIMEOUT_MS

        log("[tmux-session-manager] session check", {
          sessionId,
          statusType: status?.type,
          isIdle,
          missingSince,
          missingTooLong,
          isTimedOut,
          shouldClose: isIdle || missingTooLong || isTimedOut,
        })

        if (isIdle || missingTooLong || isTimedOut) {
          sessionsToClose.push(sessionId)
        }
      }

      for (const sessionId of sessionsToClose) {
        log("[tmux-session-manager] closing session due to poll", { sessionId })
        await this.closeSessionById(sessionId)
      }
    } catch (err) {
      log("[tmux-session-manager] poll error", { error: String(err) })
    }
  }

  private async closeSessionById(sessionId: string): Promise<void> {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return

    log("[tmux-session-manager] closing session pane", {
      sessionId,
      paneId: tracked.paneId,
    })

    const state = this.sourcePaneId ? await queryWindowState(this.sourcePaneId) : null
    if (state) {
      await executeAction(
        { type: "close", paneId: tracked.paneId, sessionId },
        { config: this.tmuxConfig, serverUrl: this.serverUrl, windowState: state }
      )
    }

    this.sessions.delete(sessionId)

    if (this.sessions.size === 0) {
      this.stopPolling()
    }
  }

  createEventHandler(): (input: { event: { type: string; properties?: unknown } }) => Promise<void> {
    return async (input) => {
      await this.onSessionCreated(input.event as SessionCreatedEvent)
    }
  }

  async cleanup(): Promise<void> {
    this.stopPolling()

    if (this.sessions.size > 0) {
      log("[tmux-session-manager] closing all panes", { count: this.sessions.size })
      const state = this.sourcePaneId ? await queryWindowState(this.sourcePaneId) : null
      
      if (state) {
        const closePromises = Array.from(this.sessions.values()).map((s) =>
          executeAction(
            { type: "close", paneId: s.paneId, sessionId: s.sessionId },
            { config: this.tmuxConfig, serverUrl: this.serverUrl, windowState: state }
          ).catch((err) =>
            log("[tmux-session-manager] cleanup error for pane", {
              paneId: s.paneId,
              error: String(err),
            }),
          ),
        )
        await Promise.all(closePromises)
      }
      this.sessions.clear()
    }

    log("[tmux-session-manager] cleanup complete")
  }
}
