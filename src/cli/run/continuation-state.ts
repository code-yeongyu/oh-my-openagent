import { getPlanProgress, readBoulderState } from "../../features/boulder-state"
import { getSessionAgent } from "../../features/claude-code-session-state"
import {
  getActiveContinuationMarkerReason,
  isContinuationMarkerActive,
  readContinuationMarker,
} from "../../features/run-continuation-state"
import { isSessionInBoulderLineage } from "../../hooks/atlas/boulder-session-lineage"
import { getLastAgentFromSession } from "../../hooks/atlas/session-last-agent"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { readState as readRalphLoopState } from "../../hooks/ralph-loop/storage"
import type { RunContext } from "./types"

export interface ContinuationState {
  hasActiveBoulder: boolean
  hasActiveRalphLoop: boolean
  hasHookMarker: boolean
  hasTodoHookMarker: boolean
  hasActiveHookMarker: boolean
  activeHookMarkerReason: string | null
}

export async function getContinuationState(
  directory: string,
  sessionID: string,
  client?: RunContext["client"],
): Promise<ContinuationState> {
  const marker = readContinuationMarker(directory, sessionID)

  return {
    hasActiveBoulder: await hasActiveBoulderContinuation(directory, sessionID, client),
    hasActiveRalphLoop: hasActiveRalphLoopContinuation(directory, sessionID),
    hasHookMarker: marker !== null,
    hasTodoHookMarker: marker?.sources.todo !== undefined,
    hasActiveHookMarker: isContinuationMarkerActive(marker),
    activeHookMarkerReason: getActiveContinuationMarkerReason(marker),
  }
}

async function hasActiveBoulderContinuation(
  directory: string,
  sessionID: string,
  client?: RunContext["client"],
): Promise<boolean> {
  const boulder = readBoulderState(directory)
  if (!boulder) return false

  const progress = getPlanProgress(boulder.active_plan)
  if (progress.isComplete) return false
  if (!client) return false

  const isTrackedSession = boulder.session_ids.includes(sessionID)
  const sessionOrigin = boulder.session_origins?.[sessionID]
  if (!isTrackedSession) {
    return false
  }

  const isTrackedDescendant = await isTrackedDescendantSession(client, sessionID, boulder.session_ids)

  if (isTrackedSession && sessionOrigin === "direct") {
    return true
  }

  if (isTrackedSession && sessionOrigin !== "direct" && !isTrackedDescendant) {
    return false
  }

  const sessionAgent = await getLastAgentFromSession(sessionID, client)
    ?? getSessionAgent(sessionID)
  if (!sessionAgent) {
    return false
  }

  const requiredAgentKey = getAgentConfigKey(boulder.agent ?? "atlas")
  const sessionAgentKey = getAgentConfigKey(sessionAgent)
  if (
    sessionAgentKey !== requiredAgentKey
    && !(requiredAgentKey === getAgentConfigKey("atlas") && sessionAgentKey === getAgentConfigKey("sisyphus"))
  ) {
    return false
  }

  return isTrackedSession || isTrackedDescendant
}

async function isTrackedDescendantSession(
  client: RunContext["client"],
  sessionID: string,
  trackedSessionIDs: string[],
): Promise<boolean> {
  const ancestorSessionIDs = trackedSessionIDs.filter((trackedSessionID) => trackedSessionID !== sessionID)
  if (ancestorSessionIDs.length === 0) {
    return false
  }

  return isSessionInBoulderLineage({
    client,
    sessionID,
    boulderSessionIDs: ancestorSessionIDs,
  })
}

function hasActiveRalphLoopContinuation(directory: string, sessionID: string): boolean {
  const state = readRalphLoopState(directory)
  if (!state || !state.active) return false

  if (state.session_id && state.session_id !== sessionID) {
    return false
  }

  return true
}
