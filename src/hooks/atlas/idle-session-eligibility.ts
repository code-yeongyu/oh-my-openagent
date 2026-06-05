import type { PluginInput } from "@opencode-ai/plugin"
import { normalizeSessionId } from "../../features/boulder-state"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { isSessionInBoulderLineage } from "./boulder-session-lineage"
import { getLastAgentFromSession } from "./session-last-agent"

export async function canContinueTrackedBoulderSession(input: {
  client: PluginInput["client"]
  sessionID: string
  sessionOrigin?: "direct" | "appended"
  boulderSessionIDs: string[]
  requiredAgent?: string
}): Promise<boolean> {
  const normalizedSessionID = normalizeSessionId(input.sessionID)
  if (input.sessionOrigin === "direct") {
    return true
  }

  const ancestorSessionIDs = input.boulderSessionIDs
    .map((sessionID) => normalizeSessionId(sessionID))
    .filter((trackedSessionID) => trackedSessionID !== normalizedSessionID)
  if (ancestorSessionIDs.length === 0) {
    return true
  }

  const isTrackedDescendant = await isSessionInBoulderLineage({
    client: input.client,
    sessionID: input.sessionID,
    boulderSessionIDs: ancestorSessionIDs,
  })
  if (!isTrackedDescendant) {
    return false
  }

  const sessionAgent = await getLastAgentFromSession(input.sessionID, input.client)
    ?? getSessionAgent(input.sessionID)
  if (!sessionAgent) {
    return false
  }

  const requiredAgentKey = getAgentConfigKey(input.requiredAgent ?? "atlas")
  const sessionAgentKey = getAgentConfigKey(sessionAgent)
  return sessionAgentKey === requiredAgentKey
    || (requiredAgentKey === getAgentConfigKey("atlas") && sessionAgentKey === getAgentConfigKey("sisyphus"))
}
