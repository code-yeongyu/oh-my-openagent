import type { PluginInput } from "@opencode-ai/plugin"

import { findNearestMessageWithFields, findFirstMessageWithAgent } from "../../features/hook-message-injector"
import {
  findFirstMessageWithAgentFromSDK,
  findNearestMessageWithFieldsFromSDK,
} from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { readBoulderState } from "../../features/boulder-state"
import { getMessageDir } from "../../shared/opencode-message-dir"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"

type OpencodeClient = PluginInput["client"]

async function getAgentFromMessageFiles(
  sessionID: string,
  client?: OpencodeClient
): Promise<string | undefined> {
  if (isSqliteBackend() && client) {
    const firstAgent = await findFirstMessageWithAgentFromSDK(client, sessionID)
    if (firstAgent) return firstAgent

    const nearest = await findNearestMessageWithFieldsFromSDK(client, sessionID)
    return nearest?.agent
  }

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
export async function getAgentFromSession(
  sessionID: string,
  directory: string,
  client?: OpencodeClient
): Promise<string | undefined> {
  // Check in-memory first (current session)
  const memoryAgent = getSessionAgent(sessionID)
  if (memoryAgent) return memoryAgent

  // Check boulder state (persisted across restarts) - fixes #927
  const boulderState = readBoulderState(directory)
  if (boulderState?.session_ids?.includes(sessionID) && boulderState.agent) {
    return boulderState.agent
  }

  // Fallback to message files
  return await getAgentFromMessageFiles(sessionID, client)
}
