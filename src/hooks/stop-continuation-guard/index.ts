import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"

const HOOK_NAME = "stop-continuation-guard"

export interface StopContinuationGuard {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  "chat.message": (input: { sessionID?: string }) => Promise<void>
  stop: (sessionID: string) => void
  isStopped: (sessionID: string) => boolean
  clear: (sessionID: string) => void
}

export function createStopContinuationGuardHook(
  _ctx: PluginInput
): StopContinuationGuard {
  const stoppedSessions = new Set<string>()

  const stop = (sessionID: string): void => {
    stoppedSessions.add(sessionID)
    log(`[${HOOK_NAME}] Continuation stopped for session`, { sessionID })
  }

  const isStopped = (sessionID: string): boolean => {
    return stoppedSessions.has(sessionID)
  }

  const clear = (sessionID: string): void => {
    stoppedSessions.delete(sessionID)
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
