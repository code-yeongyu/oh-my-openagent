import type { OpencodeClient } from "../../tools/delegate-task/types"
import {
  POLL_INTERVAL_BACKGROUND_MS,
  SESSION_MISSING_GRACE_MS,
  SESSION_READY_TIMEOUT_MS,
  SESSION_TIMEOUT_MS,
} from "../../shared/tmux"
import type { TrackedSession, WindowState } from "./types"
import { log } from "../../shared"
import { resolveMessageEventSessionID } from "../../shared/event-session-id"
import { parseSessionStatusResponse } from "./session-status-parser"

const MIN_STABILITY_TIME_MS = 10 * 1000
const STABLE_POLLS_REQUIRED = 3

// Soft cap on `this.sessions` size. Reaching this threshold means either a
// genuine high-workload run OR a leak the existing close paths failed to
// catch. We do NOT auto-evict — silent eviction could kill panes the user
// is actively using. Instead we log loudly so the operator can investigate.
// Warnings are deduped by doubling (50 → 100 → 200 → ...) to keep logs
// readable while still surfacing growth that's worth attention.
export const TRACKED_SESSIONS_WARN_THRESHOLD = 50

export class TmuxPollingManager {
  private pollInterval?: ReturnType<typeof setInterval>
  private pollingInFlight = false
  private lastWarnedTrackedSize?: number

  constructor(
    private client: OpencodeClient,
    private sessions: Map<string, TrackedSession>,
    private closeSessionById: (sessionId: string) => Promise<void>,
    private retryPendingCloses?: () => Promise<void>,
    private getWindowState?: () => Promise<WindowState | null>,
    private activateSessionPane?: (tracked: TrackedSession) => Promise<boolean>,
    private canActivatePane: (state: WindowState) => boolean = (state) => state.windowActive !== false && state.sessionAttached !== false,
  ) {}

  private warnIfTrackedSessionsExceedThreshold(): void {
    const size = this.sessions.size
    if (size < TRACKED_SESSIONS_WARN_THRESHOLD) {
      // Reset so a fresh climb past the threshold logs again.
      this.lastWarnedTrackedSize = undefined
      return
    }
    // Re-emit only when size has doubled relative to the last warning (or
    // on the first crossing of the threshold). Prevents log spam while
    // still surfacing real growth.
    if (this.lastWarnedTrackedSize !== undefined && size < this.lastWarnedTrackedSize * 2) {
      return
    }
    log("[tmux-session-manager] tracked-sessions count exceeded soft cap; investigate for leak or runaway spawn", {
      count: size,
      threshold: TRACKED_SESSIONS_WARN_THRESHOLD,
      previousWarnAt: this.lastWarnedTrackedSize,
    })
    this.lastWarnedTrackedSize = size
  }

  handleEvent(event: { type: string; properties?: Record<string, unknown> }): void {
    const sessionId = this.getEventSessionId(event)
    if (!sessionId) return

    const tracked = this.sessions.get(sessionId)
    if (!tracked) return

    tracked.activityVersion = (tracked.activityVersion ?? 0) + 1
  }

  startPolling(): void {
    if (this.pollInterval) return

    this.pollInterval = setInterval(
      () => this.pollSessions(),
      POLL_INTERVAL_BACKGROUND_MS, // POLL_INTERVAL_BACKGROUND_MS
    )
    log("[tmux-session-manager] polling started")
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = undefined
      log("[tmux-session-manager] polling stopped")
    }
  }

  private async pollSessions(): Promise<void> {
    if (this.pollingInFlight) return
    this.pollingInFlight = true
    try {
      if (this.sessions.size === 0) {
        this.stopPolling()
        return
      }

      this.warnIfTrackedSessionsExceedThreshold()

      await this.activateFocusedPanes()

      const statusResult = await this.client.session.status({ path: undefined })
      const allStatuses = parseSessionStatusResponse(statusResult)

      log("[tmux-session-manager] pollSessions", {
        trackedSessions: Array.from(this.sessions.keys()),
        allStatusKeys: Object.keys(allStatuses),
      })

      const now = Date.now()
      const sessionsToClose: string[] = []

      for (const [sessionId, tracked] of this.sessions.entries()) {
        const status = allStatuses[sessionId]
        const elapsedMs = now - tracked.createdAt.getTime()
        if (!tracked.attachActivated && !status) {
          if (elapsedMs <= SESSION_TIMEOUT_MS) {
            log("[tmux-session-manager] placeholder pane has not been activated yet; skipping close checks", {
              sessionId,
              paneId: tracked.paneId,
              elapsedMs,
            })
            continue
          }
          log("[tmux-session-manager] never-activated pane exceeded hard timeout; closing", {
            sessionId,
            paneId: tracked.paneId,
            elapsedMs,
          })
          if (!tracked.closePending) {
            tracked.closePending = true
            sessionsToClose.push(sessionId)
          }
          continue
        }

        const attachElapsedMs = tracked.attachActivatedAt
          ? now - tracked.attachActivatedAt.getTime()
          : undefined
        if (tracked.attachActivated && !status && attachElapsedMs !== undefined && attachElapsedMs < SESSION_READY_TIMEOUT_MS) {
          log("[tmux-session-manager] waiting for first post-activation session status", {
            sessionId,
            paneId: tracked.paneId,
            attachElapsedMs,
            graceMs: SESSION_READY_TIMEOUT_MS,
          })
          continue
        }

        const isIdle = status?.type === "idle"

        if (status) {
          tracked.lastSeenAt = new Date(now)
        }

        const missingSince = !status ? now - tracked.lastSeenAt.getTime() : 0
        const missingTooLong = missingSince >= SESSION_MISSING_GRACE_MS
        const isTimedOut = elapsedMs > SESSION_TIMEOUT_MS

        let shouldCloseViaStability = false

        if (isIdle && elapsedMs >= MIN_STABILITY_TIME_MS) {
          const activityVersion = tracked.activityVersion ?? 0

          if (tracked.observedIdleActivityVersion !== activityVersion) {
            tracked.stableIdlePolls = 1
            tracked.observedIdleActivityVersion = activityVersion
          } else {
            tracked.stableIdlePolls = (tracked.stableIdlePolls ?? 0) + 1
          }

          if ((tracked.stableIdlePolls ?? 0) >= STABLE_POLLS_REQUIRED) {
            const stableWindowActivityVersion = tracked.observedIdleActivityVersion ?? activityVersion
            const recheckResult = await this.client.session.status({ path: undefined })
            const recheckStatuses = parseSessionStatusResponse(recheckResult)
            const recheckStatus = recheckStatuses[sessionId]
            const latestTracked = this.sessions.get(sessionId) ?? tracked
            const recheckActivityVersion = latestTracked.activityVersion ?? 0

            if (recheckActivityVersion !== stableWindowActivityVersion) {
              latestTracked.stableIdlePolls = 0
              latestTracked.observedIdleActivityVersion = recheckActivityVersion
              log("[tmux-session-manager] stability recheck aborted after new activity", {
                sessionId,
                stableWindowActivityVersion,
                recheckActivityVersion,
              })
            } else if (recheckStatus?.type === "idle") {
              shouldCloseViaStability = true
            } else {
              latestTracked.stableIdlePolls = 0
              log("[tmux-session-manager] stability reached but session not idle on recheck, resetting", {
                sessionId,
                recheckStatus: recheckStatus?.type,
              })
            }
          }
        } else if (!isIdle) {
          tracked.stableIdlePolls = 0
          tracked.observedIdleActivityVersion = undefined
        }

        log("[tmux-session-manager] session check", {
          sessionId,
          statusType: status?.type,
          isIdle,
          elapsedMs,
          stableIdlePolls: tracked.stableIdlePolls,
          activityVersion: tracked.activityVersion,
          observedIdleActivityVersion: tracked.observedIdleActivityVersion,
          missingSince,
          missingTooLong,
          isTimedOut,
          shouldCloseViaStability,
        })

        if (!tracked.closePending && (shouldCloseViaStability || missingTooLong || isTimedOut)) {
          tracked.closePending = true
          sessionsToClose.push(sessionId)
        }
      }

      for (const sessionId of sessionsToClose) {
        log("[tmux-session-manager] closing session due to poll", { sessionId })
        await this.closeSessionById(sessionId)
      }

      if (this.retryPendingCloses) {
        try {
          await this.retryPendingCloses()
        } catch (err) {
          log("[tmux-session-manager] retry pending closes failed", { error: String(err) })
        }
      }
    } catch (err) {
      log("[tmux-session-manager] poll error", { error: String(err) })
    } finally {
      this.pollingInFlight = false
    }
  }

  private getEventSessionId(event: { type: string; properties?: Record<string, unknown> }): string | undefined {
    const properties = event.properties
    if (!properties) return undefined

    if (event.type === "message.updated") {
      return resolveMessageEventSessionID(properties)
    }

    if (
      event.type === "message.part.updated"
      || event.type === "message.part.delta"
      || event.type === "message.part.removed"
      || event.type === "message.removed"
    ) {
      return resolveMessageEventSessionID(properties)
    }

    return undefined
  }

  private async activateFocusedPanes(): Promise<void> {
    if (!this.getWindowState || !this.activateSessionPane || this.sessions.size === 0) {
      return
    }

    const state = await this.getWindowState().catch(() => null)
    if (!state) return
    if (this.canActivatePane && !this.canActivatePane(state)) {
      log("[tmux-session-manager] activation gate blocked auto-attach", {
        windowActive: state.windowActive,
        sessionAttached: state.sessionAttached,
      })
      return
    }

    const panes = [state.mainPane, ...state.agentPanes].filter((pane): pane is NonNullable<typeof pane> => Boolean(pane))
    const activePaneIds = new Set(panes.filter((pane) => pane.isActive).map((pane) => pane.paneId))
    if (activePaneIds.size === 0) return

    for (const tracked of this.sessions.values()) {
      if (tracked.attachActivated) continue
      if (!activePaneIds.has(tracked.paneId)) continue

      const activated = await this.activateSessionPane(tracked)
      if (activated) {
        tracked.attachActivated = true
        tracked.attachActivatedAt = new Date()
        tracked.lastSeenAt = new Date()
        tracked.stableIdlePolls = 0
        tracked.observedIdleActivityVersion = tracked.activityVersion
        log("[tmux-session-manager] activated focused pane", {
          sessionId: tracked.sessionId,
          paneId: tracked.paneId,
        })
      }
    }
  }
}
