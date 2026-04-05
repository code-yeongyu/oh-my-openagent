import type { OpencodeClient } from "../../tools/delegate-task/types"
import { POLL_INTERVAL_BACKGROUND_MS } from "../../shared/tmux"
import type { TrackedSession } from "./types"
import { SESSION_MISSING_GRACE_MS } from "../../shared/tmux"
import { log } from "../../shared"
import { normalizeSDKResponse } from "../../shared"

const SESSION_TIMEOUT_MS = 10 * 60 * 1000
const MIN_STABILITY_TIME_MS = 10 * 1000
const STABLE_POLLS_REQUIRED = 3

export class TmuxPollingManager {
  private pollInterval?: ReturnType<typeof setInterval>
  private pollingInFlight = false

  constructor(
    private client: OpencodeClient,
    private sessions: Map<string, TrackedSession>,
    private closeSessionById: (sessionId: string) => Promise<void>
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

      const statusResult = await this.client.session.status({ path: undefined })
      const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)

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
        const elapsedMs = now - tracked.createdAt.getTime()

        let shouldCloseViaStability = false

        if (isIdle && elapsedMs >= MIN_STABILITY_TIME_MS) {
          const activityVersion = tracked.activityVersion ?? 0

          if (tracked.observedIdleActivityVersion === activityVersion) {
            tracked.stableIdlePolls = (tracked.stableIdlePolls ?? 0) + 1

            if (tracked.stableIdlePolls >= STABLE_POLLS_REQUIRED) {
              const recheckResult = await this.client.session.status({ path: undefined })
              const recheckStatuses = normalizeSDKResponse(recheckResult, {} as Record<string, { type: string }>)
              const recheckStatus = recheckStatuses[sessionId]

              if (recheckStatus?.type === "idle") {
                shouldCloseViaStability = true
              } else {
                tracked.stableIdlePolls = 0
                log("[tmux-session-manager] stability reached but session not idle on recheck, resetting", {
                  sessionId,
                  recheckStatus: recheckStatus?.type,
                })
              }
            }
          } else {
            tracked.stableIdlePolls = 0
            tracked.observedIdleActivityVersion = activityVersion
          }
        } else if (!isIdle) {
          tracked.stableIdlePolls = 0
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

        if (shouldCloseViaStability || missingTooLong || isTimedOut) {
          sessionsToClose.push(sessionId)
        }
      }

      for (const sessionId of sessionsToClose) {
        log("[tmux-session-manager] closing session due to poll", { sessionId })
        await this.closeSessionById(sessionId)
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
      const info = properties.info
      if (!info || typeof info !== "object") return undefined
      const sessionId = (info as { sessionID?: unknown }).sessionID
      return typeof sessionId === "string" ? sessionId : undefined
    }

    if (
      event.type === "message.part.updated"
      || event.type === "message.part.delta"
      || event.type === "message.part.removed"
      || event.type === "message.removed"
    ) {
      const sessionId = properties.sessionID
      return typeof sessionId === "string" ? sessionId : undefined
    }

    return undefined
  }
}
