import { findNearestMessageWithFields, findNearestMessageWithFieldsFromSDK } from "../features/hook-message-injector"
import { getMessageDir } from "./opencode-message-dir"
import { isSqliteBackend } from "./opencode-storage-detection"
import type { PluginInput } from "@opencode-ai/plugin"

export async function isCallerOrchestrator(sessionID?: string, client?: PluginInput["client"]): Promise<boolean> {
  if (!sessionID) return false

  // Beta mode: use SDK if client provided
  if (isSqliteBackend() && client) {
    try {
      const nearest = await findNearestMessageWithFieldsFromSDK(client, sessionID)
      return nearest?.agent?.toLowerCase() === "atlas"
    } catch {
      return false
    }
  }

  // Stable mode: use JSON files
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return false
  const nearest = findNearestMessageWithFields(messageDir)
  return nearest?.agent?.toLowerCase() === "atlas"
}
