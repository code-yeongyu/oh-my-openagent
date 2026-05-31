import type { OpencodeClient } from "../../tools/delegate-task/types"
import {
  POLL_INTERVAL_BACKGROUND_MS,
  SESSION_MISSING_GRACE_MS,
  SESSION_READY_TIMEOUT_MS,
  SESSION_TIMEOUT_MS,
} from "../../shared/tmux"
import type { TrackedSession } from "./types"
import { log } from "../../shared"
import { normalizeSDKResponse } from "../../shared"
import { resolveMessageEventSessionID } from "../../shared/event-session-id"
import { isAttachableSessionStatus } from "./attachable-session-status"

const MIN_STABILITY_TIME_MS = 4 * 1000
const STABLE_POLLS_REQUIRED = 2
const UNACTIVATED_PLACEHOLDER_MISSING_GRACE_MS = 10 * 1000

export class TmuxPollingManager {
  private pollInterval?: ReturnType<typeof setInterval>
  private pollingInFlight = false

  constructor(
    private client: OpencodeClient,
    private sessions: Map<string, TrackedSession>,
    private closeSessionById: (sessionId: string) => Promise<void>,
    private retryPendingCloses?: () => Promise<void>,
    private activateSessionPane?: (tracked: TrackedSession, knownSessionStatus?: string) => Promise<boolean>,
  ) {}

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
    void this.pollSessions()
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

      let allStatuses: Record<string, { type: string }> = {}
      try {
        const statusResult = await this.client.session.status({ path: undefined })
        allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
      } catch (statusError) {
        log("[tmux-session-manager] session status poll failed; continuing auto-attach with retrying pane command", {
          error: String(statusError),
        })
      }

      await this.activateReadyPanes(allStatuses)

      log("[tmux-session-manager] pollSessions", {
        trackedSessions: Array.from(this.sessions.keys()),
        allStatusKeys: Object.keys(allStatuses),
      })

      const now = Date.now()
      const sessionsToClose: string[] = []

      for (const [sessionId, tracked] of this.sessions.entries()) {
        const status = allStatuses[sessionId]
        const elapsedMs = now - tracked.createdAt.getTime()
        const missingGraceMs = !tracked.attachActivated
          ? UNACTIVATED_PLACEHOLDER_MISSING_GRACE_MS
          : SESSION_MISSING_GRACE_MS
        if (!tracked.attachActivated && !status && elapsedMs < missingGraceMs) {
          log("[tmux-session-manager] placeholder pane has not been activated yet; waiting through missing-status grace", {
            sessionId,
            paneId: tracked.paneId,
            elapsedMs,
            graceMs: missingGraceMs,
          })
          continue
        }
        if (!tracked.attachActivated && !status) {
          log("[tmux-session-manager] stale placeholder has no session status after grace; allowing cleanup checks", {
            sessionId,
            paneId: tracked.paneId,
            elapsedMs,
            graceMs: missingGraceMs,
          })
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

        const activeElapsedMs = tracked.attachActivatedAt
          ? now - tracked.attachActivatedAt.getTime()
          : elapsedMs
        const missingSince = !status ? now - tracked.lastSeenAt.getTime() : 0
        const missingTooLong = missingSince >= missingGraceMs
        const isTimedOut = elapsedMs > SESSION_TIMEOUT_MS

        let shouldCloseViaStability = false

        if (tracked.attachActivated && isIdle && activeElapsedMs >= MIN_STABILITY_TIME_MS) {
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
            const recheckStatuses = normalizeSDKResponse(recheckResult, {} as Record<string, { type: string }>)
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
          activeElapsedMs,
          missingSince,
          missingGraceMs,
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

  private markPaneActivated(tracked: TrackedSession, source: string): void {
    tracked.attachActivated = true
    tracked.attachActivatedAt = new Date()
    tracked.lastSeenAt = new Date()
    tracked.stableIdlePolls = 0
    tracked.observedIdleActivityVersion = tracked.activityVersion
    log("[tmux-session-manager] activated pane", {
      sessionId: tracked.sessionId,
      paneId: tracked.paneId,
      source,
    })
  }

  private async activateReadyPanes(allStatuses: Record<string, { type: string }>): Promise<void> {
    if (!this.activateSessionPane || this.sessions.size === 0) {
      return
    }

    for (const tracked of this.sessions.values()) {
      if (tracked.attachActivated) continue

      const status = allStatuses[tracked.sessionId]?.type
      if (status && !isAttachableSessionStatus(status)) {
        log("[tmux-session-manager] auto-attach skipped until status is attachable", {
          sessionId: tracked.sessionId,
          paneId: tracked.paneId,
          status,
        })
        continue
      }

      const activated = await this.activateSessionPane(tracked, status)
      if (activated) {
        this.markPaneActivated(tracked, status ? "status-poll" : "retrying-attach")
      }
    }
  }

}
