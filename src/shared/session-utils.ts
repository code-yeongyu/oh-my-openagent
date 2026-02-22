import { findNearestMessageWithFields, findNearestMessageWithFieldsFromSDK } from "../features/hook-message-injector"
import { getMessageDir } from "./opencode-message-dir"
import { isSqliteBackend } from "./opencode-storage-detection"
import { log } from "./logger"
import { getAgentConfigKey } from "./agent-display-names"
import type { PluginInput } from "@opencode-ai/plugin"

export async function isCallerOrchestrator(sessionID?: string, client?: PluginInput["client"]): Promise<boolean> {
  if (!sessionID) return false

  if (isSqliteBackend() && client) {
    try {
      const nearest = await findNearestMessageWithFieldsFromSDK(client, sessionID)
      return getAgentConfigKey(nearest?.agent ?? "") === "atlas"
    } catch (error) {
      log("[session-utils] SDK orchestrator check failed", { sessionID, error: String(error) })
      return false
    }
  }

  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return false
  const nearest = findNearestMessageWithFields(messageDir)
  return getAgentConfigKey(nearest?.agent ?? "") === "atlas"
}
