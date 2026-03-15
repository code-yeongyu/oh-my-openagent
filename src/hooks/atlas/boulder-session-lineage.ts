import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./hook-name"

export async function isSessionInBoulderLineage(input: {
  client: PluginInput["client"]
  sessionID: string
  boulderSessionIDs: string[]
}): Promise<boolean> {
  const visitedSessionIDs = new Set<string>()
  let currentSessionID = input.sessionID

  while (!visitedSessionIDs.has(currentSessionID)) {
    visitedSessionIDs.add(currentSessionID)

    const sessionResult = await input.client.session
      .get({ path: { id: currentSessionID } })
      .catch((error: unknown) => {
        log(`[${HOOK_NAME}] Failed to resolve session lineage`, {
          sessionID: input.sessionID,
          currentSessionID,
          error,
        })
        return null
      })

    if (!sessionResult || sessionResult.error) {
      return false
    }

    const parentSessionID = sessionResult.data?.parentID
    if (!parentSessionID) {
      return false
    }

    if (input.boulderSessionIDs.includes(parentSessionID)) {
      return true
    }

    currentSessionID = parentSessionID
  }

  return false
}
