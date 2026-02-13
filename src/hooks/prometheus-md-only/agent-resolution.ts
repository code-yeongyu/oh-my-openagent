import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { findNearestMessageWithFields, findFirstMessageWithAgent, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { readMissionState } from "../../features/mission-state"

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

function getAgentFromMessageFiles(sessionID: string): string | undefined {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return undefined
  return findFirstMessageWithAgent(messageDir) ?? findNearestMessageWithFields(messageDir)?.agent
}

/**
 * Get the effective agent for the session.
 * Priority order:
 * 1. In-memory session agent (most recent, set by /start-work)
 * 2. Mission state agent (persisted across restarts, fixes #927)
 * 3. Message files (fallback for sessions without mission state)
 *
 * This fixes issue #927 where after interruption:
 * - In-memory map is cleared (process restart)
 * - Message files return "oracle" (oldest message from /plan)
 * - But mission.json has agent: "architect" (set by /start-work)
 */
export function getAgentFromSession(sessionID: string, directory: string): string | undefined {
  // Check in-memory first (current session)
  const memoryAgent = getSessionAgent(sessionID)
  if (memoryAgent) return memoryAgent

  // Check mission state (persisted across restarts) - fixes #927
  const missionState = readMissionState(directory)
  if (missionState?.session_ids?.includes(sessionID) && missionState.agent) {
    return missionState.agent
  }

  // Fallback to message files
  return getAgentFromMessageFiles(sessionID)
}
