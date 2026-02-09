import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { getMessageDir } from "../../shared/session-utils"

export function getLastAgentFromSession(sessionID: string): string | null {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return null
  const nearest = findNearestMessageWithFields(messageDir)
  return nearest?.agent?.toLowerCase() ?? null
}
