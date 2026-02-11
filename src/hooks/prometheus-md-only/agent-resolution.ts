import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { findNearestMessageWithFields, findFirstMessageWithAgent, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { readBoulderState } from "../../features/boulder-state"

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
 * 2. Boulder state agent (persisted across restarts, fixes #927)
 * 3. Message files (fallback for sessions without boulder state)
 *
 * This fixes issue #927 where after interruption:
 * - In-memory map is cleared (process restart)
 * - Message files return "prometheus" (oldest message from /plan)
 * - But boulder.json has agent: "atlas" (set by /start-work)
 */
export function getAgentFromSession(sessionID: string, directory: string): string | undefined {
  // Check in-memory first (current session)
  const memoryAgent = getSessionAgent(sessionID)
  if (memoryAgent) return memoryAgent

  // Check boulder state (persisted across restarts) - fixes #927
  const boulderState = readBoulderState(directory)
  if (boulderState?.session_ids?.includes(sessionID) && boulderState.agent) {
    return boulderState.agent
  }

  // Fallback to message files
  return getAgentFromMessageFiles(sessionID)
}
