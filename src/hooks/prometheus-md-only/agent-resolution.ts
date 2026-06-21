import type { PluginInput } from "@opencode-ai/plugin"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { findFirstMessageWithAgent, 
  findFirstMessageWithAgentFromSDK,findNearestMessageWithFields, 
  findNearestMessageWithFieldsFromSDK,} from "../../features/hook-message-injector"
import { readMissionState } from "../../features/mission-state"
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
 * 2. Mission state agent (persisted across restarts, fixes #927)
 * 3. Message files (fallback for sessions without mission state)
 *
 * This fixes issue #927 where after interruption:
 * - In-memory map is cleared (process restart)
 * - Message files return "oracle" (oldest message from /plan)
 * - But mission.json has agent: "architect" (set by /start-work)
 */
export async function getAgentFromSession(
  sessionID: string,
  directory: string,
  client?: OpencodeClient
): Promise<string | undefined> {
  // Check in-memory first (current session)
  const memoryAgent = getSessionAgent(sessionID)
  if (memoryAgent) return memoryAgent

  // Check mission state (persisted across restarts) - fixes #927
  const missionState = readMissionState(directory)
  if (missionState?.session_ids?.includes(sessionID) && missionState.agent) {
    return missionState.agent
  }

  // Fallback to message files
  return await getAgentFromMessageFiles(sessionID, client)
}
