import type { BackgroundManager } from "../features/background-agent"
import { getEventSessionID } from "./event-hook-dispatcher"
import type { EventInput } from "./event-types"

export function createBackgroundTaskEvents(
  manager: BackgroundManager,
  event: (input: EventInput) => Promise<void>,
  isRecoveryPending: (sessionID: string) => boolean = () => false,
) {
  const decisions = new Map<string, number>()
  manager.setTerminalChildRecoveryCheck(sessionID =>
    decisions.has(sessionID) || isRecoveryPending(sessionID),
  )

  return {
    event,
    beginDecision(input: EventInput): (() => void) | undefined {
      if (input.event.type !== "session.error") return
      const sessionID = getEventSessionID(input)
      if (!sessionID) return
      // Reserve before any hook awaits: the manager records errors before fallback decides.
      decisions.set(sessionID, (decisions.get(sessionID) ?? 0) + 1)
      return () => {
        const remaining = (decisions.get(sessionID) ?? 1) - 1
        if (remaining === 0) decisions.delete(sessionID)
        else decisions.set(sessionID, remaining)
      }
    },
  }
}
