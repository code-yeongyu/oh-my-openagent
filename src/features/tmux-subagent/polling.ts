import type { PluginInput } from "@opencode-ai/plugin"
import type { TmuxConfig } from "../../config/schema"
import {
  POLL_INTERVAL_BACKGROUND_MS,
  SESSION_MISSING_GRACE_MS,
} from "../../shared/tmux"
import { log } from "../../shared"
import type { TrackedSession } from "./types"
import { queryWindowState } from "./pane-state-querier"
import { executeAction } from "./action-executor"
import {
  MIN_STABILITY_TIME_MS,
  SESSION_TIMEOUT_MS,
  STABLE_POLLS_REQUIRED,
} from "./polling-constants"
import { parseSessionStatusMap } from "./session-status-parser"
import { getMessageCount } from "./session-message-count"
import { waitForSessionReady as waitForSessionReadyFromClient } from "./session-ready-waiter"

type OpencodeClient = PluginInput["client"]

export interface SessionPollingController {
  startPolling: () => void
  stopPolling: () => void
  closeSessionById: (sessionId: string) => Promise<void>
  waitForSessionReady: (sessionId: string) => Promise<boolean>
  pollSessions: () => Promise<void>
}

export function createSessionPollingController(params: {
  client: OpencodeClient
  tmuxConfig: TmuxConfig
  serverUrl: string
  sourcePaneId: string | undefined
  sessions: Map<string, TrackedSession>
}): SessionPollingController {
  let pollInterval: ReturnType<typeof setInterval> | undefined

  async function closeSessionById(sessionId: string): Promise<void> {
    const tracked = params.sessions.get(sessionId)
    if (!tracked) return

    log("[tmux-session-manager] closing session pane", {
      sessionId,
      paneId: tracked.paneId,
    })

    const state = params.sourcePaneId ? await queryWindowState(params.sourcePaneId) : null
    if (state) {
      await executeAction(
        { type: "close", paneId: tracked.paneId, sessionId },
        { config: params.tmuxConfig, serverUrl: params.serverUrl, windowState: state },
      )
    }

    params.sessions.delete(sessionId)

    if (params.sessions.size === 0) {
      stopPolling()
    }
  }

  async function pollSessions(): Promise<void> {
    if (params.sessions.size === 0) {
      stopPolling()
      return
    }

    try {
      const statusResult = await params.client.session.status({ path: undefined })
      const allStatuses = parseSessionStatusMap(statusResult.data)

      log("[tmux-session-manager] pollSessions", {
        trackedSessions: Array.from(params.sessions.keys()),
        allStatusKeys: Object.keys(allStatuses),
      })

      const now = Date.now()
      const sessionsToClose: string[] = []

      for (const [sessionId, tracked] of params.sessions.entries()) {
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
          try {
            const messagesResult = await params.client.session.messages({
              path: { id: sessionId },
            })
            const currentMessageCount = getMessageCount(messagesResult.data)

            if (tracked.lastMessageCount === currentMessageCount) {
              tracked.stableIdlePolls = (tracked.stableIdlePolls ?? 0) + 1

              if (tracked.stableIdlePolls >= STABLE_POLLS_REQUIRED) {
                const recheckResult = await params.client.session.status({ path: undefined })
                const recheckStatuses = parseSessionStatusMap(recheckResult.data)
                const recheckStatus = recheckStatuses[sessionId]

                if (recheckStatus?.type === "idle") {
                  shouldCloseViaStability = true
                } else {
                  tracked.stableIdlePolls = 0
                  log(
                    "[tmux-session-manager] stability reached but session not idle on recheck, resetting",
                    { sessionId, recheckStatus: recheckStatus?.type },
                  )
                }
              }
            } else {
              tracked.stableIdlePolls = 0
            }

            tracked.lastMessageCount = currentMessageCount
          } catch (messageError) {
            log("[tmux-session-manager] failed to fetch messages for stability check", {
              sessionId,
              error: String(messageError),
            })
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
          lastMessageCount: tracked.lastMessageCount,
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
        await closeSessionById(sessionId)
      }
    } catch (error) {
      log("[tmux-session-manager] poll error", { error: String(error) })
    }
  }

  function startPolling(): void {
    if (pollInterval) return
    pollInterval = setInterval(() => {
      void pollSessions()
    }, POLL_INTERVAL_BACKGROUND_MS)
    log("[tmux-session-manager] polling started")
  }

  function stopPolling(): void {
    if (!pollInterval) return
    clearInterval(pollInterval)
    pollInterval = undefined
    log("[tmux-session-manager] polling stopped")
  }

  async function waitForSessionReady(sessionId: string): Promise<boolean> {
    return waitForSessionReadyFromClient({ client: params.client, sessionId })
  }

  return { startPolling, stopPolling, closeSessionById, waitForSessionReady, pollSessions }
}
