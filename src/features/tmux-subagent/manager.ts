import type { PluginInput } from "@opencode-ai/plugin"
import type { TmuxConfig } from "../../config/schema"
import type { TrackedSession, CapacityConfig, WindowState } from "./types"
import * as sharedModule from "../../shared"
import {
  isInsideTmux as defaultIsInsideTmux,
  getCurrentPaneId as defaultGetCurrentPaneId,
  POLL_INTERVAL_BACKGROUND_MS,
  spawnTmuxWindow,
  spawnTmuxSession,
  killTmuxSessionIfExists,
  getIsolatedSessionName,
  sweepStaleOmoAgentSessions,
} from "../../shared/tmux"
import { queryWindowState as defaultQueryWindowState } from "./pane-state-querier"
import { decideSpawnActions, decideCloseAction, type SessionMapping } from "./decision-engine"
import { executeActions, executeAction } from "./action-executor"
import { TmuxPollingManager } from "./polling-manager"
import { createTrackedSession, markTrackedSessionClosePending } from "./tracked-session-state"
import { waitForSessionReady } from "./session-ready-waiter"
import { isAttachableSessionStatus } from "./attachable-session-status"
import { parseSessionStatusMap } from "./session-status-parser"
type OpencodeClient = PluginInput["client"]

type SpawnStage =
  | "deferred.attach"
  | "deferred.isolated-container"
  | "session.created"
  | "session.idle.retry"

interface SessionCreatedEvent {
  type: string
  properties?: { info?: { id?: string; parentID?: string; title?: string } }
}

interface DeferredSession {
  sessionId: string
  title: string
  queuedAt: Date
  retryIsolatedContainer: boolean
}

interface FailedReadinessSessionSeed {
  sessionId: string
  title: string
}

interface FailedReadinessSession extends FailedReadinessSessionSeed {
  rememberedAt: number
}

export interface TmuxUtilDeps {
  isInsideTmux: () => boolean
  getCurrentPaneId: () => string | undefined
  queryWindowState: (paneId: string) => Promise<WindowState | null>
  waitForSessionReady: (params: { client: OpencodeClient; sessionId: string }) => Promise<boolean>
  log: typeof sharedModule.log
}

const defaultTmuxDeps: TmuxUtilDeps = {
  isInsideTmux: defaultIsInsideTmux,
  getCurrentPaneId: defaultGetCurrentPaneId,
  queryWindowState: defaultQueryWindowState,
  waitForSessionReady,
  log: sharedModule.log,
}

const DEFERRED_SESSION_TTL_MS = 5 * 60 * 1000
const FAILED_READINESS_SESSION_TTL_MS = 5 * 60 * 1000
const FAILED_READINESS_SWEEP_INTERVAL_MS = 60 * 1000
const MAX_DEFERRED_QUEUE_SIZE = 20
const MAX_CLOSE_RETRY_COUNT = 3
const MAX_ISOLATED_CONTAINER_NULL_STATE_COUNT = 2

export class TmuxSessionManager {
  private client: OpencodeClient
  private tmuxConfig: TmuxConfig
  private projectDirectory: string
  private serverUrl: string
  private sourcePaneId: string | undefined
  private sessions = new Map<string, TrackedSession>()
  private pendingSessions = new Set<string>()
  private failedReadinessSessions = new Map<string, FailedReadinessSession>()
  private closedByPolling = new Set<string>()
  private failedReadinessSweepInterval?: ReturnType<typeof setInterval>
  private spawnQueue: Promise<void> = Promise.resolve()
  private deferredSessions = new Map<string, DeferredSession>()
  private deferredQueue: string[] = []
  private deferredAttachInterval?: ReturnType<typeof setInterval>
  private deferredAttachTickScheduled = false
  private nullStateCount = 0
  private deps: TmuxUtilDeps
  private pollingManager: TmuxPollingManager
  private isolatedContainerPaneId: string | undefined
  private isolatedWindowPaneId: string | undefined
  private isolatedContainerNullStateCount = 0
  private staleSweepCompleted = false
  private staleSweepInProgress = false
  constructor(ctx: PluginInput, tmuxConfig: TmuxConfig, deps: Partial<TmuxUtilDeps> = {}) {
    this.client = ctx.client
    this.tmuxConfig = tmuxConfig
    this.projectDirectory = ctx.directory || process.cwd()
    this.deps = { ...defaultTmuxDeps, ...deps }
    const configuredPort = process.env.OPENCODE_PORT
    const parsedPort = configuredPort ? Number(configuredPort) : 4096
    const defaultPort = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
      ? String(parsedPort)
      : "4096"
    const fallbackUrl = `http://localhost:${defaultPort}`
    const rawServerUrl = ctx.serverUrl?.toString()
    try {
      if (rawServerUrl) {
        const parsed = new URL(rawServerUrl)
        const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
        this.serverUrl = port === '0' ? fallbackUrl : rawServerUrl
      } else {
        this.serverUrl = fallbackUrl
      }
    } catch (error) {
      this.deps.log("[tmux-session-manager] failed to parse server URL, using fallback", {
        serverUrl: rawServerUrl,
        error: String(error),
      })
      this.serverUrl = fallbackUrl
    }
    this.sourcePaneId = this.deps.getCurrentPaneId()
    this.pollingManager = new TmuxPollingManager(
      this.client,
      this.sessions,
      this.closeSessionFromPolling.bind(this),
      this.retryPendingCloses.bind(this)
    )
    this.deps.log("[tmux-session-manager] initialized", {
      configEnabled: this.tmuxConfig.enabled,
      tmuxConfig: this.tmuxConfig,
      projectDirectory: this.projectDirectory,
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
        const state = await this.deps.queryWindowState(this.isolatedWindowPaneId).catch((error) => {
        this.deps.log("[tmux-session-manager] failed to query isolated window state", {
          paneId: this.isolatedWindowPaneId,
          error: String(error),
        })
        return null
      })
      if (state) {
        this.isolatedContainerNullStateCount = 0
        return null
      }
      this.isolatedContainerNullStateCount += 1
      this.deps.log("[tmux-session-manager] isolated container state query returned null", {
        paneId: this.isolatedWindowPaneId,
        nullStateCount: this.isolatedContainerNullStateCount,
        maxNullStateCount: MAX_ISOLATED_CONTAINER_NULL_STATE_COUNT,
      })
      if (this.isolatedContainerNullStateCount < MAX_ISOLATED_CONTAINER_NULL_STATE_COUNT) {
        return null
      }
      this.isolatedContainerPaneId = undefined
      this.isolatedWindowPaneId = undefined
      this.isolatedContainerNullStateCount = 0
    }

    const isolation = this.tmuxConfig.isolation
    this.deps.log("[tmux-session-manager] creating isolated tmux container", { isolation, sessionId, title })

    const result = isolation === "session"
      ? await spawnTmuxSession(sessionId, title, this.tmuxConfig, this.serverUrl, this.projectDirectory, this.sourcePaneId)
      : await spawnTmuxWindow(sessionId, title, this.tmuxConfig, this.serverUrl, this.projectDirectory)

    if (result.success && result.paneId) {
      this.isolatedContainerPaneId = result.paneId
      this.isolatedWindowPaneId = result.paneId
      this.isolatedContainerNullStateCount = 0
      this.deps.log("[tmux-session-manager] isolated container created", {
        isolation,
        paneId: result.paneId,
      })
      return result.paneId
    }
    this.deps.log("[tmux-session-manager] failed to create isolated container", { isolation, sessionId })
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

  getTrackedPaneId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.paneId
  }

  getServerUrl(): string {
    return this.serverUrl
  }

  private removeTrackedSession(sessionId: string): void {
    this.sessions.delete(sessionId)

    if (this.sessions.size === 0) {
      this.pollingManager.stopPolling()
    }
  }

  private reassignIsolatedContainerAnchor(): void {
    const nextAnchor = this.sessions.values().next().value
    if (!nextAnchor) {
      return
    }

    this.isolatedContainerNullStateCount = 0
    this.isolatedWindowPaneId = nextAnchor.paneId
    this.deps.log("[tmux-session-manager] reassigned isolated container anchor pane", {
      sessionId: nextAnchor.sessionId,
      paneId: nextAnchor.paneId,
    })
  }

  private async cleanupIsolatedContainerAfterSessionDeletion(
    tracked: TrackedSession,
    isolatedPaneAlreadyClosed: boolean,
    state: WindowState,
  ): Promise<void> {
    if (tracked.paneId !== this.isolatedWindowPaneId) {
      return
    }

    if (this.sessions.size > 0) {
      this.reassignIsolatedContainerAnchor()
      return
    }

    const isolatedContainerPaneId = this.isolatedContainerPaneId
    this.isolatedContainerNullStateCount = 0
    this.isolatedContainerPaneId = undefined
    this.isolatedWindowPaneId = undefined

    if (!isolatedContainerPaneId) {
      return
    }

    if (isolatedPaneAlreadyClosed && tracked.paneId === isolatedContainerPaneId) {
      return
    }

    try {
      const result = await executeAction(
        { type: "close", paneId: isolatedContainerPaneId, sessionId: tracked.sessionId },
        {
          config: this.tmuxConfig,
          directory: this.projectDirectory,
          serverUrl: this.serverUrl,
          windowState: state,
          sourcePaneId: this.sourcePaneId ?? tracked.paneId,
        },
      )

      if (!result.success) {
        this.deps.log("[tmux-session-manager] failed to close isolated container pane after anchor session deletion", {
          sessionId: tracked.sessionId,
          paneId: isolatedContainerPaneId,
        })
      }
    } catch (error) {
      this.deps.log("[tmux-session-manager] failed to cleanup isolated container pane after anchor session deletion", {
        sessionId: tracked.sessionId,
        paneId: isolatedContainerPaneId,
        error: String(error),
      })
    }
  }

  private markSessionClosePending(sessionId: string): void {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return

    this.sessions.set(sessionId, markTrackedSessionClosePending(tracked))
    this.deps.log("[tmux-session-manager] marked session close pending", {
      sessionId,
      paneId: tracked.paneId,
      closeRetryCount: tracked.closeRetryCount,
    })
  }

  private async queryWindowStateSafely(): Promise<WindowState | null> {
    const paneId = this.getEffectiveSourcePaneId()
    if (!paneId) return null

    try {
      return await this.deps.queryWindowState(paneId)
    } catch (error) {
      this.deps.log("[tmux-session-manager] failed to query window state for close", {
        error: String(error),
      })
      return null
    }
  }

  private windowStateContainsPane(state: WindowState, paneId: string): boolean {
    return state.mainPane?.paneId === paneId
      || state.agentPanes.some((pane) => pane.paneId === paneId)
  }

  private async finalizeForceRemoveCandidate(
    tracked: TrackedSession,
    source: string,
  ): Promise<boolean> {
    const state = await this.queryWindowStateSafely()
    if (!state) {
      this.deps.log("[tmux-session-manager] unable to verify pane after max close retries; keeping session tracked", {
        sessionId: tracked.sessionId,
        paneId: tracked.paneId,
        source,
      })
      return false
    }

    if (this.windowStateContainsPane(state, tracked.paneId)) {
      this.deps.log("[tmux-session-manager] pane still exists after max close retries; manual intervention required", {
        sessionId: tracked.sessionId,
        paneId: tracked.paneId,
        source,
      })
      return false
    }

    this.deps.log("[tmux-session-manager] pane already gone after max close retries; finalizing tracked close", {
      sessionId: tracked.sessionId,
      paneId: tracked.paneId,
      source,
    })
    await this.finalizeTrackedSessionClose({
      tracked,
      state,
      isolatedPaneAlreadyClosed: true,
    })
    return true
  }

  private async closeTrackedSessionPane(args: {
    tracked: TrackedSession
    state: WindowState
  }): Promise<boolean> {
    const { tracked, state } = args

    try {
      const result = await executeAction(
        { type: "close", paneId: tracked.paneId, sessionId: tracked.sessionId },
        {
          config: this.tmuxConfig,
          directory: this.projectDirectory,
          serverUrl: this.serverUrl,
          windowState: state,
          sourcePaneId: this.getEffectiveSourcePaneId(),
        }
      )

      return result.success
    } catch (error) {
      this.deps.log("[tmux-session-manager] close session pane failed", {
        sessionId: tracked.sessionId,
        paneId: tracked.paneId,
        error: String(error),
      })
      return false
    }
  }

  private async finalizeTrackedSessionClose(args: {
    tracked: TrackedSession
    state: WindowState
    isolatedPaneAlreadyClosed: boolean
  }): Promise<void> {
    const { tracked, state, isolatedPaneAlreadyClosed } = args
    this.removeTrackedSession(tracked.sessionId)
    await this.cleanupIsolatedContainerAfterSessionDeletion(
      tracked,
      isolatedPaneAlreadyClosed,
      state,
    )
  }

  private async closeTrackedSession(tracked: TrackedSession): Promise<boolean> {
    const state = await this.queryWindowStateSafely()
    if (!state) return false

    const closed = await this.closeTrackedSessionPane({ tracked, state })
    if (!closed) {
      return false
    }

    await this.finalizeTrackedSessionClose({
      tracked,
      state,
      isolatedPaneAlreadyClosed: true,
    })
    return true
  }

  private async retryPendingCloses(): Promise<void> {
    const pendingSessions = Array.from(this.sessions.values()).filter(
      (tracked) => tracked.closePending,
    )

    for (const tracked of pendingSessions) {
      if (!this.sessions.has(tracked.sessionId)) continue

      if (tracked.closeRetryCount >= MAX_CLOSE_RETRY_COUNT) {
        await this.finalizeForceRemoveCandidate(tracked, "retryPendingCloses.max-retries")
        continue
      }

      const closed = await this.closeTrackedSession(tracked)
      if (closed) {
        this.deps.log("[tmux-session-manager] retried close succeeded", {
          sessionId: tracked.sessionId,
          paneId: tracked.paneId,
          closeRetryCount: tracked.closeRetryCount,
        })
        continue
      }

      const currentTracked = this.sessions.get(tracked.sessionId)
      if (!currentTracked || !currentTracked.closePending) {
        continue
      }

      const nextRetryCount = currentTracked.closeRetryCount + 1
      if (nextRetryCount >= MAX_CLOSE_RETRY_COUNT) {
        await this.finalizeForceRemoveCandidate(currentTracked, "retryPendingCloses.failed-retry")
        continue
      }

      this.sessions.set(currentTracked.sessionId, {
        ...currentTracked,
        closePending: true,
        closeRetryCount: nextRetryCount,
      })
      this.deps.log("[tmux-session-manager] retried close failed", {
        sessionId: currentTracked.sessionId,
        paneId: currentTracked.paneId,
        closeRetryCount: nextRetryCount,
      })
    }
  }

  private enqueueDeferredSession(
    sessionId: string,
    title: string,
    retryIsolatedContainer = false,
  ): void {
    if (this.shouldSkipRespawnAfterPollingClose(sessionId, "deferred enqueue")) {
      this.clearFailedReadinessSession(sessionId)
      return
    }

    const existingDeferredSession = this.deferredSessions.get(sessionId)
    if (existingDeferredSession) {
      if (retryIsolatedContainer && !existingDeferredSession.retryIsolatedContainer) {
        this.deferredSessions.set(sessionId, {
          ...existingDeferredSession,
          retryIsolatedContainer: true,
        })
      }
      return
    }
    if (this.deferredQueue.length >= MAX_DEFERRED_QUEUE_SIZE) {
      this.deps.log("[tmux-session-manager] deferred queue full, dropping session", {
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
      retryIsolatedContainer,
    })
    this.deferredQueue.push(sessionId)
    this.deps.log("[tmux-session-manager] deferred session queued", {
      sessionId,
      queueLength: this.deferredQueue.length,
    })
    this.startDeferredAttachLoop()
  }

  private removeDeferredSession(sessionId: string): void {
    if (!this.deferredSessions.delete(sessionId)) return
    this.deferredQueue = this.deferredQueue.filter((id) => id !== sessionId)
    this.deps.log("[tmux-session-manager] deferred session removed", {
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
    this.deps.log("[tmux-session-manager] deferred attach polling started", {
      intervalMs: POLL_INTERVAL_BACKGROUND_MS,
    })
  }

  private stopDeferredAttachLoop(): void {
    if (!this.deferredAttachInterval) return
    clearInterval(this.deferredAttachInterval)
    this.deferredAttachInterval = undefined
    this.deferredAttachTickScheduled = false
    this.nullStateCount = 0
    this.deps.log("[tmux-session-manager] deferred attach polling stopped")
  }

  private beginPendingSession(
    sessionId: string,
    options?: { allowDeferredSession?: boolean },
  ): boolean {
    if (
      this.sessions.has(sessionId)
      || this.pendingSessions.has(sessionId)
      || (!options?.allowDeferredSession && this.deferredSessions.has(sessionId))
    ) {
      this.deps.log("[tmux-session-manager] session already tracked or pending", { sessionId })
      return false
    }

    this.pendingSessions.add(sessionId)
    return true
  }

  private async ensureSessionReadyBeforeSpawn(
    sessionId: string,
    stage: SpawnStage,
  ): Promise<boolean> {
    try {
      const ready = await this.deps.waitForSessionReady({
        client: this.client,
        sessionId,
      })

      if (ready) {
        return true
      }

      const readinessError = new Error("Session readiness timed out")
      this.deps.log("[tmux-session-manager] session readiness failed before spawn", {
        sessionId,
        stage,
        error: String(readinessError),
      })
      return false
    } catch (error) {
      this.deps.log("[tmux-session-manager] session readiness failed before spawn", {
        sessionId,
        stage,
        error: String(error),
      })
      return false
    }
  }

  private async getSessionStatusType(sessionId: string): Promise<string | undefined> {
    try {
      const statusResult = await this.client.session.status({ path: undefined })
      const allStatuses = parseSessionStatusMap(statusResult.data)
      return allStatuses[sessionId]?.type
    } catch (error) {
      this.deps.log("[tmux-session-manager] failed to read session status before spawn", {
        sessionId,
        error: String(error),
      })
      return undefined
    }
  }

  private rememberFailedReadinessSession(
    session: FailedReadinessSessionSeed,
  ): void {
    this.failedReadinessSessions.set(session.sessionId, {
      ...session,
      rememberedAt: Date.now(),
    })
    this.startFailedReadinessSweep()
  }

  private clearFailedReadinessSession(sessionId: string): void {
    this.failedReadinessSessions.delete(sessionId)
    if (this.failedReadinessSessions.size === 0) {
      this.stopFailedReadinessSweep()
    }
  }

  private startFailedReadinessSweep(): void {
    if (this.failedReadinessSweepInterval) {
      return
    }

    this.failedReadinessSweepInterval = setInterval(() => {
      this.sweepExpiredFailedReadinessSessions()
    }, FAILED_READINESS_SWEEP_INTERVAL_MS)
  }

  private stopFailedReadinessSweep(): void {
    if (!this.failedReadinessSweepInterval) {
      return
    }

    clearInterval(this.failedReadinessSweepInterval)
    this.failedReadinessSweepInterval = undefined
  }

  private isFailedReadinessSessionExpired(
    session: FailedReadinessSession,
    now: number,
  ): boolean {
    return now - session.rememberedAt >= FAILED_READINESS_SESSION_TTL_MS
  }

  private sweepExpiredFailedReadinessSessions(): void {
    const now = Date.now()

    for (const [sessionId, failedReadinessSession] of this.failedReadinessSessions.entries()) {
      if (!this.isFailedReadinessSessionExpired(failedReadinessSession, now)) {
        continue
      }

      this.failedReadinessSessions.delete(sessionId)
      this.deps.log("[tmux-session-manager] expired failed readiness session", {
        sessionId,
        ttlMs: FAILED_READINESS_SESSION_TTL_MS,
      })
    }

    if (this.failedReadinessSessions.size === 0) {
      this.stopFailedReadinessSweep()
    }
  }

  private getFailedReadinessSession(sessionId: string): FailedReadinessSession | undefined {
    const failedReadinessSession = this.failedReadinessSessions.get(sessionId)
    if (!failedReadinessSession) {
      return undefined
    }

    if (!this.isFailedReadinessSessionExpired(failedReadinessSession, Date.now())) {
      return failedReadinessSession
    }

    this.failedReadinessSessions.delete(sessionId)
    this.deps.log("[tmux-session-manager] expired failed readiness session on access", {
      sessionId,
      ttlMs: FAILED_READINESS_SESSION_TTL_MS,
    })

    if (this.failedReadinessSessions.size === 0) {
      this.stopFailedReadinessSweep()
    }

    return undefined
  }

  private async spawnPendingSession(args: {
    session: FailedReadinessSessionSeed
    stage: SpawnStage
    rememberReadinessFailure: boolean
  }): Promise<void> {
    const { session, stage, rememberReadinessFailure } = args
    const { sessionId, title } = session

    const readyForSpawn = await this.ensureSessionReadyBeforeSpawn(sessionId, stage)
    if (!readyForSpawn) {
      if (rememberReadinessFailure) {
        this.rememberFailedReadinessSession(session)
      }
      return
    }

    const sessionStatus = await this.getSessionStatusType(sessionId)
    if (!isAttachableSessionStatus(sessionStatus)) {
      this.deps.log("[tmux-session-manager] session not attachable for pane spawn", {
        sessionId,
        stage,
        status: sessionStatus,
      })
      if (rememberReadinessFailure) {
        this.rememberFailedReadinessSession(session)
      }
      return
    }

    this.clearFailedReadinessSession(sessionId)

    const isolatedPaneId = await this.spawnInIsolatedContainer(sessionId, title)
    if (isolatedPaneId) {
      this.sessions.set(
        sessionId,
        createTrackedSession({ sessionId, paneId: isolatedPaneId, description: title }),
      )
      this.pollingManager.startPolling()
      this.deps.log("[tmux-session-manager] first subagent spawned in isolated window", {
        sessionId,
        paneId: isolatedPaneId,
      })
      return
    }

    if (this.isIsolated() && !this.isolatedWindowPaneId) {
      this.deps.log("[tmux-session-manager] isolated container failed, deferring session for retry", { sessionId })
      this.enqueueDeferredSession(sessionId, title, true)
      return
    }
    const sourcePaneId = this.getEffectiveSourcePaneId()
    if (!sourcePaneId) {
      this.deps.log("[tmux-session-manager] no effective source pane id")
      return
    }

    const state = await this.deps.queryWindowState(sourcePaneId)
    if (!state) {
      this.deps.log("[tmux-session-manager] failed to query window state, deferring session")
      this.enqueueDeferredSession(sessionId, title)
      return
    }

    this.deps.log("[tmux-session-manager] window state queried", {
      windowWidth: state.windowWidth,
      mainPane: state.mainPane?.paneId,
      agentPaneCount: state.agentPanes.length,
      agentPanes: state.agentPanes.map((pane) => pane.paneId),
    })

    const decision = decideSpawnActions(
      state,
      sessionId,
      title,
      this.getCapacityConfig(),
      this.getSessionMappings(),
    )

    this.deps.log("[tmux-session-manager] spawn decision", {
      canSpawn: decision.canSpawn,
      reason: decision.reason,
      actionCount: decision.actions.length,
      actions: decision.actions.map((action) => {
        if (action.type === "close") return { type: "close", paneId: action.paneId }
        if (action.type === "replace") {
          return {
            type: "replace",
            paneId: action.paneId,
            newSessionId: action.newSessionId,
          }
        }
        return { type: "spawn", sessionId: action.sessionId }
      }),
    })

    if (!decision.canSpawn) {
      this.deps.log("[tmux-session-manager] cannot spawn", { reason: decision.reason })
      this.enqueueDeferredSession(sessionId, title)
      return
    }

    const result = await executeActions(
      decision.actions,
      {
        config: this.tmuxConfig,
        directory: this.projectDirectory,
        serverUrl: this.serverUrl,
        windowState: state,
        sourcePaneId,
      },
    )

    for (const { action, result: actionResult } of result.results) {
      if (action.type === "close" && actionResult.success) {
        this.sessions.delete(action.sessionId)
        this.deps.log("[tmux-session-manager] removed closed session from cache", {
          sessionId: action.sessionId,
        })
      }
      if (action.type === "replace" && actionResult.success) {
        this.sessions.delete(action.oldSessionId)
        this.deps.log("[tmux-session-manager] removed replaced session from cache", {
          oldSessionId: action.oldSessionId,
          newSessionId: action.newSessionId,
        })
      }
    }

    if (result.success && result.spawnedPaneId) {
      this.sessions.set(
        sessionId,
        createTrackedSession({
          sessionId,
          paneId: result.spawnedPaneId,
          description: title,
        }),
      )
      this.clearFailedReadinessSession(sessionId)
      this.deps.log("[tmux-session-manager] pane spawned and tracked", {
        sessionId,
        paneId: result.spawnedPaneId,
      })
      this.pollingManager.startPolling()
      return
    }

    this.deps.log("[tmux-session-manager] spawn failed", {
      success: result.success,
      results: result.results.map((resultEntry) => ({
        type: resultEntry.action.type,
        success: resultEntry.result.success,
        error: resultEntry.result.error,
      })),
    })

    this.deps.log("[tmux-session-manager] re-queueing deferred session after spawn failure", {
      sessionId,
    })
    this.enqueueDeferredSession(sessionId, title)

    if (result.spawnedPaneId) {
      await executeAction(
        { type: "close", paneId: result.spawnedPaneId, sessionId },
        {
          config: this.tmuxConfig,
          directory: this.projectDirectory,
          serverUrl: this.serverUrl,
          windowState: state,
        },
      )
    }
  }

  private getEventSessionId(event: {
    type: string
    properties?: Record<string, unknown>
  }): string | undefined {
    const sessionId = event.properties?.sessionID
    return typeof sessionId === "string" ? sessionId : undefined
  }

  private async retryFailedReadinessSession(sessionId: string): Promise<void> {
    if (this.shouldSkipRespawnAfterPollingClose(sessionId, "session.idle retry")) {
      return
    }

    const failedReadinessSession = this.getFailedReadinessSession(sessionId)
    if (!failedReadinessSession) {
      return
    }

    if (!this.beginPendingSession(sessionId)) {
      return
    }

    try {
      await this.enqueueSpawn(async () => {
        try {
          const sessionStatus = await this.getSessionStatusType(sessionId)
          if (!isAttachableSessionStatus(sessionStatus)) {
            this.deps.log("[tmux-session-manager] session.idle retry skipped because session is not attachable", {
              sessionId,
              status: sessionStatus,
            })
            return
          }

          this.clearFailedReadinessSession(sessionId)
          await this.spawnPendingSession({
            session: failedReadinessSession,
            stage: "session.idle.retry",
            rememberReadinessFailure: false,
          })
        } finally {
          this.pendingSessions.delete(sessionId)
        }
      })
    } finally {
      this.pendingSessions.delete(sessionId)
    }
  }

  private async tryAttachDeferredSession(): Promise<void> {
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

    if (this.shouldSkipRespawnAfterPollingClose(sessionId, "deferred attach")) {
      this.removeDeferredSession(sessionId)
      return
    }

    if (!this.beginPendingSession(sessionId, { allowDeferredSession: true })) {
      return
    }

    try {
      if (Date.now() - deferred.queuedAt.getTime() > DEFERRED_SESSION_TTL_MS) {
        this.deferredQueue.shift()
        this.deferredSessions.delete(sessionId)
        this.deps.log("[tmux-session-manager] deferred session expired", {
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

      if (deferred.retryIsolatedContainer) {
        const readyForIsolatedContainer = await this.ensureSessionReadyBeforeSpawn(
          sessionId,
          "deferred.isolated-container",
        )
        if (!readyForIsolatedContainer) {
          this.removeDeferredSession(sessionId)
          return
        }

        const isolatedPaneId = await this.spawnInIsolatedContainer(sessionId, deferred.title)
        if (isolatedPaneId) {
          this.sessions.set(
            sessionId,
            createTrackedSession({
              sessionId,
              paneId: isolatedPaneId,
              description: deferred.title,
            }),
          )
          this.removeDeferredSession(sessionId)
          this.pollingManager.startPolling()
          this.deps.log("[tmux-session-manager] deferred session attached in isolated window", {
            sessionId,
            paneId: isolatedPaneId,
          })
          return
        }
      }

      const effectiveSourcePaneId = this.getEffectiveSourcePaneId()
      if (!effectiveSourcePaneId) return

      const state = await this.deps.queryWindowState(effectiveSourcePaneId)
      if (!state) {
        this.nullStateCount += 1
        this.deps.log("[tmux-session-manager] deferred attach window state is null", {
          nullStateCount: this.nullStateCount,
        })
        if (this.nullStateCount >= 3) {
          this.deps.log("[tmux-session-manager] stopping deferred attach loop after consecutive null states", {
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
        this.deps.log("[tmux-session-manager] deferred session still waiting for capacity", {
          sessionId,
          reason: decision.reason,
        })
        return
      }

      const readyForDeferredAttach = await this.ensureSessionReadyBeforeSpawn(
        sessionId,
        "deferred.attach",
      )
      if (!readyForDeferredAttach) {
        this.removeDeferredSession(sessionId)
        return
      }

      const result = await executeActions(decision.actions, {
        config: this.tmuxConfig,
        directory: this.projectDirectory,
        serverUrl: this.serverUrl,
        windowState: state,
        sourcePaneId: effectiveSourcePaneId,
      })

      if (!result.success || !result.spawnedPaneId) {
        this.deps.log("[tmux-session-manager] deferred session attach failed", {
          sessionId,
          results: result.results.map((r) => ({
            type: r.action.type,
            success: r.result.success,
            error: r.result.error,
          })),
        })
        return
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
      this.deps.log("[tmux-session-manager] deferred session attached", {
        sessionId,
        paneId: result.spawnedPaneId,
      })
    } finally {
      this.pendingSessions.delete(sessionId)
    }
  }

  async onSessionCreated(event: SessionCreatedEvent): Promise<void> {
    const enabled = this.isEnabled()
    this.deps.log("[tmux-session-manager] onSessionCreated called", {
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
      this.deps.log("[tmux-session-manager] no source pane id")
      return
    }

    if (!this.beginPendingSession(sessionId)) {
      return
    }

    try {
      await this.sweepStaleIsolatedSessionsOnce()
      await this.retryPendingCloses()

      const session = { sessionId, title }

      await this.enqueueSpawn(async () => {
        try {
          await this.spawnPendingSession({
            session,
            stage: "session.created",
            rememberReadinessFailure: true,
          })
        } finally {
          this.pendingSessions.delete(sessionId)
        }
      })
    } finally {
      this.pendingSessions.delete(sessionId)
    }
  }

  private async enqueueSpawn(run: () => Promise<void>): Promise<void> {
    this.spawnQueue = this.spawnQueue
      .catch((error) => {
        this.deps.log("[tmux-session-manager] recovering spawn queue after previous failure", {
          error: String(error),
        })
      })
      .then(run)
      .catch((err) => {
        this.deps.log("[tmux-session-manager] spawn queue task failed", {
          error: String(err),
        })
      })
    await this.spawnQueue
  }

  async onSessionDeleted(event: { sessionID: string }): Promise<void> {
    if (!this.isEnabled()) return

    this.closedByPolling.delete(event.sessionID)
    this.clearFailedReadinessSession(event.sessionID)
    this.removeDeferredSession(event.sessionID)

    if (!this.getEffectiveSourcePaneId()) return

    const tracked = this.sessions.get(event.sessionID)
    if (!tracked) return

    this.deps.log("[tmux-session-manager] onSessionDeleted", { sessionId: event.sessionID })

    const state = await this.queryWindowStateSafely()
    if (!state) {
      this.markSessionClosePending(event.sessionID)
      return
    }

    const closeAction = decideCloseAction(state, event.sessionID, this.getSessionMappings())
    if (!closeAction) {
      await this.finalizeTrackedSessionClose({
        tracked,
        state,
        isolatedPaneAlreadyClosed: false,
      })
      return
    }

    const isolatedPaneAlreadyClosed =
      closeAction.type === "close" && closeAction.paneId === tracked.paneId

    try {
      const result = await executeAction(closeAction, {
        config: this.tmuxConfig,
        directory: this.projectDirectory,
        serverUrl: this.serverUrl,
        windowState: state,
        sourcePaneId: this.getEffectiveSourcePaneId(),
      })

      if (!result.success) {
        this.markSessionClosePending(event.sessionID)
        return
      }
    } catch (error) {
      this.deps.log("[tmux-session-manager] failed to close pane for deleted session", {
        sessionId: event.sessionID,
        error: String(error),
      })
      this.markSessionClosePending(event.sessionID)
      return
    }

    await this.finalizeTrackedSessionClose({
      tracked,
      state,
      isolatedPaneAlreadyClosed,
    })
  }


  private async closeSessionById(sessionId: string): Promise<void> {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return

    if (tracked.closePending && tracked.closeRetryCount >= MAX_CLOSE_RETRY_COUNT) {
      await this.finalizeForceRemoveCandidate(tracked, "closeSessionById.max-retries")
      return
    }

    this.deps.log("[tmux-session-manager] closing session pane", {
      sessionId,
      paneId: tracked.paneId,
    })

    const closed = await this.closeTrackedSession(tracked)
    if (!closed) {
      this.markSessionClosePending(sessionId)
      return
    }
  }

  private async closeSessionFromPolling(sessionId: string): Promise<void> {
    this.closedByPolling.add(sessionId)
    await this.closeSessionById(sessionId)
  }

  private shouldSkipRespawnAfterPollingClose(sessionId: string, source: string): boolean {
    if (!this.closedByPolling.has(sessionId)) {
      return false
    }

    this.deps.log("[tmux-session-manager] skipping tmux respawn because polling already closed the session", {
      sessionId,
      source,
    })
    return true
  }

  onEvent(event: { type: string; properties?: Record<string, unknown> }): void {
    this.pollingManager.handleEvent(event)

    const sessionId = this.getEventSessionId(event)
    if (event.type !== "session.idle" || !sessionId) {
      return
    }

    void this.retryFailedReadinessSession(sessionId).catch((error) => {
      this.deps.log("[tmux-session-manager] session.idle retry failed", {
        sessionId,
        error: String(error),
      })
    })
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
    this.failedReadinessSessions.clear()
    this.closedByPolling.clear()
    this.stopFailedReadinessSweep()
    this.pollingManager.stopPolling()

    if (this.sessions.size > 0) {
      this.deps.log("[tmux-session-manager] closing all panes", { count: this.sessions.size })

      const sessionIds = Array.from(this.sessions.keys())
      for (const sessionId of sessionIds) {
        try {
          await this.closeSessionById(sessionId)
        } catch (error) {
          this.deps.log("[tmux-session-manager] cleanup error for pane", {
            sessionId,
            error: String(error),
          })
        }
      }
    }

    await this.retryPendingCloses()
    this.isolatedContainerNullStateCount = 0
    this.isolatedContainerPaneId = undefined
    this.isolatedWindowPaneId = undefined

    if (this.tmuxConfig.isolation === "session") {
      const isolatedSessionName = getIsolatedSessionName()
      try {
        const killed = await killTmuxSessionIfExists(isolatedSessionName)
        this.deps.log("[tmux-session-manager] isolated session teardown", {
          session: isolatedSessionName,
          killed,
        })
      } catch (error) {
        this.deps.log("[tmux-session-manager] isolated session teardown failed", {
          session: isolatedSessionName,
          error: String(error),
        })
      }
    }

    this.staleSweepCompleted = false
    this.staleSweepInProgress = false

    this.deps.log("[tmux-session-manager] cleanup complete")
  }

  private async sweepStaleIsolatedSessionsOnce(): Promise<void> {
    if (this.staleSweepCompleted) return
    if (this.staleSweepInProgress) return
    if (this.tmuxConfig.isolation !== "session") {
      this.staleSweepCompleted = true
      return
    }

    this.staleSweepInProgress = true
    try {
      const killed = await sweepStaleOmoAgentSessions()
      if (killed > 0) {
        this.deps.log("[tmux-session-manager] stale isolated sessions swept", { killed })
      }
      this.staleSweepCompleted = true
    } catch (error) {
      this.deps.log("[tmux-session-manager] stale sweep failed", {
        error: String(error),
      })
    } finally {
      this.staleSweepInProgress = false
    }
  }
}
