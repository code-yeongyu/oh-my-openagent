import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"

import {
  clearContinuationMarker,
  setContinuationMarkerSource,
} from "../../features/run-continuation-state"
import { log } from "../../shared/logger"

const HOOK_NAME = "stop-continuation-guard"

type StopContinuationBackgroundManager = Pick<
  BackgroundManager,
  "getAllDescendantTasks" | "cancelTask"
>

export interface StopContinuationGuard {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  "chat.message": (input: { sessionID?: string }) => Promise<void>
  stop: (sessionID: string) => void
  isStopped: (sessionID: string) => boolean
  clear: (sessionID: string) => void
}

export function createStopContinuationGuardHook(
  ctx: PluginInput,
  options?: {
    backgroundManager?: StopContinuationBackgroundManager
  }
): StopContinuationGuard {
  const stoppedSessions = new Set<string>()

  const stop = (sessionID: string): void => {
    stoppedSessions.add(sessionID)
    setContinuationMarkerSource(ctx.directory, sessionID, "stop", "stopped", "continuation stopped")
    log(`[${HOOK_NAME}] Continuation stopped for session`, { sessionID })

    const backgroundManager = options?.backgroundManager
    if (!backgroundManager) {
      return
    }

    const cancellableTasks = backgroundManager
      .getAllDescendantTasks(sessionID)
      .filter((task) => task.status === "running" || task.status === "pending")

    if (cancellableTasks.length === 0) {
      return
    }

    void Promise.allSettled(
      cancellableTasks.map(async (task) => {
        await backgroundManager.cancelTask(task.id, {
          source: "stop-continuation",
          reason: "Continuation stopped via /stop-continuation",
          abortSession: task.status === "running",
          skipNotification: true,
        })
      })
    ).then((results) => {
      const cancelledCount = results.filter((result) => result.status === "fulfilled").length
      const failedCount = results.length - cancelledCount
      log(`[${HOOK_NAME}] Cancelled background tasks for stopped session`, {
        sessionID,
        cancelledCount,
        failedCount,
      })
    })
  }

  const isStopped = (sessionID: string): boolean => {
    return stoppedSessions.has(sessionID)
  }

  const clear = (sessionID: string): void => {
    stoppedSessions.delete(sessionID)
    setContinuationMarkerSource(ctx.directory, sessionID, "stop", "idle")
    log(`[${HOOK_NAME}] Continuation guard cleared for session`, { sessionID })
  }

  const event = async ({
    event,
  }: {
    event: { type: string; properties?: unknown }
  }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        clear(sessionInfo.id)
        clearContinuationMarker(ctx.directory, sessionInfo.id)
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
      }
    }
  }

  const chatMessage = async ({
    sessionID,
  }: {
    sessionID?: string
  }): Promise<void> => {
    if (sessionID && stoppedSessions.has(sessionID)) {
      clear(sessionID)
      log(`[${HOOK_NAME}] Cleared stop state on new user message`, { sessionID })
    }
  }

  return {
    event,
    "chat.message": chatMessage,
    stop,
    isStopped,
    clear,
  }
}
