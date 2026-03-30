import type { PluginInput } from "@opencode-ai/plugin"
import type { TmuxConfig } from "../../config/schema"
import type { TrackedSession, CapacityConfig, WindowState } from "./types"
import { log, normalizeSDKResponse } from "../../shared"
import {
  isInsideTmux as defaultIsInsideTmux,
  getCurrentPaneId as defaultGetCurrentPaneId,
  POLL_INTERVAL_BACKGROUND_MS,
  SESSION_READY_POLL_INTERVAL_MS,
  SESSION_READY_TIMEOUT_MS,
  spawnTmuxWindow,
  spawnTmuxSession,
} from "../../shared/tmux"
import { queryWindowState } from "./pane-state-querier"
import { decideSpawnActions, decideCloseAction, type SessionMapping } from "./decision-engine"
import { executeActions, executeAction } from "./action-executor"
import { TmuxPollingManager } from "./polling-manager"
import { createTrackedSession, markTrackedSessionClosePending } from "./tracked-session-state"
type OpencodeClient = PluginInput["client"]

interface SessionCreatedEvent {
  type: string
  properties?: { info?: { id?: string; parentID?: string; title?: string } }
}

interface DeferredSession {
  sessionId: string
  title: string
  queuedAt: Date
}

export interface TmuxUtilDeps {
  isInsideTmux: () => boolean
  getCurrentPaneId: () => string | undefined
}

const defaultTmuxDeps: TmuxUtilDeps = {
  isInsideTmux: defaultIsInsideTmux,
  getCurrentPaneId: defaultGetCurrentPaneId,
}

const DEFERRED_SESSION_TTL_MS = 5 * 60 * 1000
const MAX_DEFERRED_QUEUE_SIZE = 20
const MAX_CLOSE_RETRY_COUNT = 3

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
  private spawnQueue: Promise<void> = Promise.resolve()
  private deferredSessions = new Map<string, DeferredSession>()
  private deferredQueue: string[] = []
  private deferredAttachInterval?: ReturnType<typeof setInterval>
  private deferredAttachTickScheduled = false
  private nullStateCount = 0
  private deps: TmuxUtilDeps
  private pollingManager: TmuxPollingManager
  private isolatedWindowPaneId: string | undefined
  constructor(ctx: PluginInput, tmuxConfig: TmuxConfig, deps: TmuxUtilDeps = defaultTmuxDeps) {
    this.client = ctx.client
    this.tmuxConfig = tmuxConfig
    this.deps = deps
    const defaultPort = process.env.OPENCODE_PORT ?? "4096"
    const fallbackUrl = `http://localhost:${defaultPort}`
    try {
      const raw = ctx.serverUrl?.toString()
      if (raw) {
        const parsed = new URL(raw)
        const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
        this.serverUrl = port === '0' ? fallbackUrl : raw
      } else {
        this.serverUrl = fallbackUrl
      }
    } catch {
      this.serverUrl = fallbackUrl
    }
    this.sourcePaneId = deps.getCurrentPaneId()
    this.pollingManager = new TmuxPollingManager(
      this.client,
      this.sessions,
      this.closeSessionById.bind(this)
    )
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

  private isIsolated(): boolean {
    return this.tmuxConfig.isolation === "window" || this.tmuxConfig.isolation === "session"
  }

  private getEffectiveSourcePaneId(): string | undefined {
    if (this.isIsolated() && this.isolatedWindowPaneId) {
      return this.isolatedWindowPaneId
    }
    return this.sourcePaneId
  }

  private async spawnInIsolatedContainer(
    sessionId: string,
    title: string,
  ): Promise<string | null> {
    if (!this.isIsolated()) return null
    if (this.isolatedWindowPaneId) {
      const state = await queryWindowState(this.isolatedWindowPaneId).catch(() => null)
      if (state) return null
      this.isolatedWindowPaneId = undefined
    }

    const isolation = this.tmuxConfig.isolation
    log("[tmux-session-manager] creating isolated tmux container", { isolation, sessionId, title })

    const result = isolation === "session"
      ? await spawnTmuxSession(sessionId, title, this.tmuxConfig, this.serverUrl, this.sourcePaneId)
      : await spawnTmuxWindow(sessionId, title, this.tmuxConfig, this.serverUrl)

    if (result.success && result.paneId) {
      this.isolatedWindowPaneId = result.paneId
      log("[tmux-session-manager] isolated container created", {
        isolation,
        paneId: result.paneId,
      })
      return result.paneId
    }
    log("[tmux-session-manager] failed to create isolated container", { isolation, sessionId })
    return null
  }

  private getCapacityConfig(): CapacityConfig {
    return {
      layout: this.tmuxConfig.layout,
      mainPaneSize: this.tmuxConfig.main_pane_size,
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

  private removeTrackedSession(sessionId: string): void {
    this.sessions.delete(sessionId)

    if (this.sessions.size === 0) {
      this.pollingManager.stopPolling()
    }
  }

  private markSessionClosePending(sessionId: string): void {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return

    this.sessions.set(sessionId, markTrackedSessionClosePending(tracked))
    log("[tmux-session-manager] marked session close pending", {
      sessionId,
      paneId: tracked.paneId,
      closeRetryCount: tracked.closeRetryCount,
    })
  }

  private async queryWindowStateSafely(): Promise<WindowState | null> {
    const paneId = this.getEffectiveSourcePaneId()
    if (!paneId) return null

    try {
      return await queryWindowState(paneId)
    } catch (error) {
      log("[tmux-session-manager] failed to query window state for close", {
        error: String(error),
      })
      return null
    }
  }

  private async tryCloseTrackedSession(tracked: TrackedSession): Promise<boolean> {
    const state = await this.queryWindowStateSafely()
    if (!state) return false

    try {
      const result = await executeAction(
        { type: "close", paneId: tracked.paneId, sessionId: tracked.sessionId },
        {
          config: this.tmuxConfig,
          serverUrl: this.serverUrl,
          windowState: state,
          sourcePaneId: this.getEffectiveSourcePaneId(),
        }
      )

      return result.success
    } catch (error) {
      log("[tmux-session-manager] close session pane failed", {
        sessionId: tracked.sessionId,
        paneId: tracked.paneId,
        error: String(error),
      })
      return false
    }
  }

  private async retryPendingCloses(): Promise<void> {
    const pendingSessions = Array.from(this.sessions.values()).filter(
      (tracked) => tracked.closePending,
    )

    for (const tracked of pendingSessions) {
      if (!this.sessions.has(tracked.sessionId)) continue

      if (tracked.closeRetryCount >= MAX_CLOSE_RETRY_COUNT) {
        log("[tmux-session-manager] force removing close-pending session after max retries", {
          sessionId: tracked.sessionId,
          paneId: tracked.paneId,
          closeRetryCount: tracked.closeRetryCount,
        })
        this.removeTrackedSession(tracked.sessionId)
        continue
      }

      const closed = await this.tryCloseTrackedSession(tracked)
      if (closed) {
        log("[tmux-session-manager] retried close succeeded", {
          sessionId: tracked.sessionId,
          paneId: tracked.paneId,
          closeRetryCount: tracked.closeRetryCount,
        })
        this.removeTrackedSession(tracked.sessionId)
        continue
      }

      const currentTracked = this.sessions.get(tracked.sessionId)
      if (!currentTracked || !currentTracked.closePending) {
        continue
      }

      const nextRetryCount = currentTracked.closeRetryCount + 1
      if (nextRetryCount >= MAX_CLOSE_RETRY_COUNT) {
        log("[tmux-session-manager] force removing close-pending session after failed retry", {
          sessionId: currentTracked.sessionId,
          paneId: currentTracked.paneId,
          closeRetryCount: nextRetryCount,
        })
        this.removeTrackedSession(currentTracked.sessionId)
        continue
      }

      this.sessions.set(currentTracked.sessionId, {
        ...currentTracked,
        closePending: true,
        closeRetryCount: nextRetryCount,
      })
      log("[tmux-session-manager] retried close failed", {
        sessionId: currentTracked.sessionId,
        paneId: currentTracked.paneId,
        closeRetryCount: nextRetryCount,
      })
    }
  }

  private enqueueDeferredSession(sessionId: string, title: string): void {
    if (this.deferredSessions.has(sessionId)) return
    if (this.deferredQueue.length >= MAX_DEFERRED_QUEUE_SIZE) {
      log("[tmux-session-manager] deferred queue full, dropping session", {
        sessionId,
        queueLength: this.deferredQueue.length,
        maxQueueSize: MAX_DEFERRED_QUEUE_SIZE,
      })
      return
    }
    this.deferredSessions.set(sessionId, {
      sessionId,
      title,
      queuedAt: new Date(),
    })
    this.deferredQueue.push(sessionId)
    log("[tmux-session-manager] deferred session queued", {
      sessionId,
      queueLength: this.deferredQueue.length,
    })
    this.startDeferredAttachLoop()
  }

  private removeDeferredSession(sessionId: string): void {
    if (!this.deferredSessions.delete(sessionId)) return
    this.deferredQueue = this.deferredQueue.filter((id) => id !== sessionId)
    log("[tmux-session-manager] deferred session removed", {
      sessionId,
      queueLength: this.deferredQueue.length,
    })
    if (this.deferredQueue.length === 0) {
      this.stopDeferredAttachLoop()
    }
  }

  private startDeferredAttachLoop(): void {
    if (this.deferredAttachInterval) return
    this.nullStateCount = 0
    this.deferredAttachInterval = setInterval(() => {
      if (this.deferredAttachTickScheduled) return
      this.deferredAttachTickScheduled = true
      void this.enqueueSpawn(async () => {
        try {
          await this.tryAttachDeferredSession()
        } finally {
          this.deferredAttachTickScheduled = false
        }
      })
    }, POLL_INTERVAL_BACKGROUND_MS)
    log("[tmux-session-manager] deferred attach polling started", {
      intervalMs: POLL_INTERVAL_BACKGROUND_MS,
    })
  }

  private stopDeferredAttachLoop(): void {
    if (!this.deferredAttachInterval) return
    clearInterval(this.deferredAttachInterval)
    this.deferredAttachInterval = undefined
    this.deferredAttachTickScheduled = false
    this.nullStateCount = 0
    log("[tmux-session-manager] deferred attach polling stopped")
  }

  private async tryAttachDeferredSession(): Promise<void> {
    const effectiveSourcePaneId = this.getEffectiveSourcePaneId()
    if (!effectiveSourcePaneId) return
    const sessionId = this.deferredQueue[0]
    if (!sessionId) {
      this.stopDeferredAttachLoop()
      return
    }

    const deferred = this.deferredSessions.get(sessionId)
    if (!deferred) {
      this.deferredQueue.shift()
      return
    }

    if (Date.now() - deferred.queuedAt.getTime() > DEFERRED_SESSION_TTL_MS) {
      this.deferredQueue.shift()
      this.deferredSessions.delete(sessionId)
      log("[tmux-session-manager] deferred session expired", {
        sessionId,
        queuedAt: deferred.queuedAt.toISOString(),
        ttlMs: DEFERRED_SESSION_TTL_MS,
        queueLength: this.deferredQueue.length,
      })
      if (this.deferredQueue.length === 0) {
        this.stopDeferredAttachLoop()
      }
      return
    }

    const state = await queryWindowState(effectiveSourcePaneId)
    if (!state) {
      this.nullStateCount += 1
      log("[tmux-session-manager] deferred attach window state is null", {
        nullStateCount: this.nullStateCount,
      })
      if (this.nullStateCount >= 3) {
        log("[tmux-session-manager] stopping deferred attach loop after consecutive null states", {
          nullStateCount: this.nullStateCount,
        })
        this.stopDeferredAttachLoop()
      }
      return
    }
    this.nullStateCount = 0

    const decision = decideSpawnActions(
      state,
      sessionId,
      deferred.title,
      this.getCapacityConfig(),
      this.getSessionMappings(),
    )

    if (!decision.canSpawn || decision.actions.length === 0) {
      log("[tmux-session-manager] deferred session still waiting for capacity", {
        sessionId,
        reason: decision.reason,
      })
      return
    }

    const result = await executeActions(decision.actions, {
      config: this.tmuxConfig,
      serverUrl: this.serverUrl,
      windowState: state,
      sourcePaneId: effectiveSourcePaneId,
    })

    if (!result.success || !result.spawnedPaneId) {
      log("[tmux-session-manager] deferred session attach failed", {
        sessionId,
        results: result.results.map((r) => ({
          type: r.action.type,
          success: r.result.success,
          error: r.result.error,
        })),
      })
      return
    }

    const sessionReady = await this.waitForSessionReady(sessionId)
    if (!sessionReady) {
      log("[tmux-session-manager] deferred session not ready after timeout", {
        sessionId,
        paneId: result.spawnedPaneId,
      })
    }

    this.sessions.set(
      sessionId,
      createTrackedSession({
        sessionId,
        paneId: result.spawnedPaneId,
        description: deferred.title,
      }),
    )
    this.removeDeferredSession(sessionId)
    this.pollingManager.startPolling()
    log("[tmux-session-manager] deferred session attached", {
      sessionId,
      paneId: result.spawnedPaneId,
      sessionReady,
    })
  }

  private async waitForSessionReady(sessionId: string): Promise<boolean> {
    const startTime = Date.now()
    
    while (Date.now() - startTime < SESSION_READY_TIMEOUT_MS) {
      try {
        const statusResult = await this.client.session.status({ path: undefined })
        const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
        
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

    if (!this.sourcePaneId) {
      log("[tmux-session-manager] no source pane id")
      return
    }

    await this.retryPendingCloses()

    if (
      this.sessions.has(sessionId) ||
      this.pendingSessions.has(sessionId) ||
      this.deferredSessions.has(sessionId)
    ) {
      log("[tmux-session-manager] session already tracked or pending", { sessionId })
      return
    }

    this.pendingSessions.add(sessionId)

    await this.enqueueSpawn(async () => {
      try {
        const isolatedPaneId = await this.spawnInIsolatedContainer(sessionId, title)
        if (isolatedPaneId) {
          const sessionReady = await this.waitForSessionReady(sessionId)
          this.sessions.set(
            sessionId,
            createTrackedSession({ sessionId, paneId: isolatedPaneId, description: title }),
          )
          this.pollingManager.startPolling()
          log("[tmux-session-manager] first subagent spawned in isolated window", {
            sessionId,
            paneId: isolatedPaneId,
            sessionReady,
          })
          return
        }

        if (this.isIsolated()) {
          log("[tmux-session-manager] isolated container failed, skipping inline fallback to preserve isolation", { sessionId })
          return
        }
        const sourcePaneId = this.getEffectiveSourcePaneId()
        if (!sourcePaneId) {
          log("[tmux-session-manager] no effective source pane id")
          return
        }

        const state = await queryWindowState(sourcePaneId)
        if (!state) {
          log("[tmux-session-manager] failed to query window state, deferring session")
          this.enqueueDeferredSession(sessionId, title)
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
          this.enqueueDeferredSession(sessionId, title)
          return
        }

        const result = await executeActions(
          decision.actions,
          {
            config: this.tmuxConfig,
            serverUrl: this.serverUrl,
            windowState: state,
            sourcePaneId,
          }
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

          this.sessions.set(
            sessionId,
            createTrackedSession({
              sessionId,
              paneId: result.spawnedPaneId,
              description: title,
            }),
          )
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

          log("[tmux-session-manager] re-queueing deferred session after spawn failure", {
            sessionId,
          })
          this.enqueueDeferredSession(sessionId, title)

          if (result.spawnedPaneId) {
            await executeAction(
              { type: "close", paneId: result.spawnedPaneId, sessionId },
              { config: this.tmuxConfig, serverUrl: this.serverUrl, windowState: state }
            )
          }

          return
        }
      } finally {
        this.pendingSessions.delete(sessionId)
      }
    })
  }

  private async enqueueSpawn(run: () => Promise<void>): Promise<void> {
    this.spawnQueue = this.spawnQueue
      .catch(() => undefined)
      .then(run)
      .catch((err) => {
        log("[tmux-session-manager] spawn queue task failed", {
          error: String(err),
        })
      })
    await this.spawnQueue
  }

  async onSessionDeleted(event: { sessionID: string }): Promise<void> {
    if (!this.isEnabled()) return
    if (!this.getEffectiveSourcePaneId()) return

    this.removeDeferredSession(event.sessionID)

    const tracked = this.sessions.get(event.sessionID)
    if (!tracked) return

    log("[tmux-session-manager] onSessionDeleted", { sessionId: event.sessionID })

    const state = await this.queryWindowStateSafely()
    if (!state) {
      this.markSessionClosePending(event.sessionID)
      return
    }

    const closeAction = decideCloseAction(state, event.sessionID, this.getSessionMappings())
    if (!closeAction) {
      this.removeTrackedSession(event.sessionID)
      return
    }

    try {
      const result = await executeAction(closeAction, {
        config: this.tmuxConfig,
        serverUrl: this.serverUrl,
        windowState: state,
        sourcePaneId: this.getEffectiveSourcePaneId(),
      })

      if (!result.success) {
        this.markSessionClosePending(event.sessionID)
        return
      }
    } catch (error) {
      log("[tmux-session-manager] failed to close pane for deleted session", {
        sessionId: event.sessionID,
        error: String(error),
      })
      this.markSessionClosePending(event.sessionID)
      return
    }

    this.removeTrackedSession(event.sessionID)
  }


  private async closeSessionById(sessionId: string): Promise<void> {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return

    if (tracked.closePending && tracked.closeRetryCount >= MAX_CLOSE_RETRY_COUNT) {
      log("[tmux-session-manager] force removing close-pending session after max retries", {
        sessionId,
        paneId: tracked.paneId,
        closeRetryCount: tracked.closeRetryCount,
      })
      this.removeTrackedSession(sessionId)
      return
    }

    log("[tmux-session-manager] closing session pane", {
      sessionId,
      paneId: tracked.paneId,
    })

    const closed = await this.tryCloseTrackedSession(tracked)
    if (!closed) {
      this.markSessionClosePending(sessionId)
      return
    }

    this.removeTrackedSession(sessionId)
  }

  createEventHandler(): (input: { event: { type: string; properties?: unknown } }) => Promise<void> {
    return async (input) => {
      await this.onSessionCreated(input.event as SessionCreatedEvent)
    }
  }

  async cleanup(): Promise<void> {
    this.stopDeferredAttachLoop()
    this.deferredQueue = []
    this.deferredSessions.clear()
    this.pollingManager.stopPolling()

    if (this.sessions.size > 0) {
      log("[tmux-session-manager] closing all panes", { count: this.sessions.size })

      const sessionIds = Array.from(this.sessions.keys())
      for (const sessionId of sessionIds) {
        try {
          await this.closeSessionById(sessionId)
        } catch (error) {
          log("[tmux-session-manager] cleanup error for pane", {
            sessionId,
            error: String(error),
          })
        }
      }
    }

    await this.retryPendingCloses()
    this.isolatedWindowPaneId = undefined

    log("[tmux-session-manager] cleanup complete")
  }
}
