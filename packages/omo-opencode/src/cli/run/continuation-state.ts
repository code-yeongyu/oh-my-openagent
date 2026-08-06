import { getPlanProgress, normalizeSessionId, readBoulderState, resolveBoulderPlanPath } from "../../features/boulder-state"
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
  hasActiveBackgroundTaskMarker: boolean
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
    hasActiveBackgroundTaskMarker: marker?.sources["background-task"]?.state === "active",
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

  const progress = getPlanProgress(resolveBoulderPlanPath(directory, boulder))
  if (progress.isComplete) return false
  if (!client) return false

  const normalizedSessionID = normalizeSessionId(sessionID)
  const normalizedTrackedSessionIDs = boulder.session_ids.map((trackedSessionID) => normalizeSessionId(trackedSessionID))
  if (!normalizedTrackedSessionIDs.includes(normalizedSessionID)) {
    return false
  }

  const sessionOrigin = boulder.session_origins?.[sessionID] ?? boulder.session_origins?.[normalizedSessionID]
  if (sessionOrigin === "direct") {
    return true
  }

  const trackedAncestorSessionIDs = normalizedTrackedSessionIDs
    .filter((trackedSessionID) => trackedSessionID !== normalizedSessionID)
  if (trackedAncestorSessionIDs.length === 0) {
    return true
  }

  const isTrackedDescendant = await isTrackedDescendantSession(client, sessionID, trackedAncestorSessionIDs)
  if (!isTrackedDescendant) {
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

  return true
}

async function isTrackedDescendantSession(
  client: RunContext["client"],
  sessionID: string,
  trackedAncestorSessionIDs: string[],
): Promise<boolean> {
  if (trackedAncestorSessionIDs.length === 0) {
    return false
  }

  return isSessionInBoulderLineage({
    client,
    sessionID,
    boulderSessionIDs: trackedAncestorSessionIDs,
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
