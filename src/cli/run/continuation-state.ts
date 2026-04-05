import { getPlanProgress, readBoulderState } from "../../features/boulder-state"
import {
  getSessionAgent,
  isAgentRegistered,
  subagentSessions,
} from "../../features/claude-code-session-state"
import {
  getActiveContinuationMarkerReason,
  isContinuationMarkerActive,
  readContinuationMarker,
} from "../../features/run-continuation-state"
import { isSessionInBoulderLineage } from "../../hooks/atlas/boulder-session-lineage"
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
  if (boulder.session_ids.includes(sessionID)) return true
  if (!client) return false
  if (!subagentSessions.has(sessionID)) return false

  const requiredAgentName = boulder.agent ?? (isAgentRegistered("atlas") ? "atlas" : undefined)
  if (!requiredAgentName || !isAgentRegistered(requiredAgentName)) {
    return false
  }

  const sessionAgent = getSessionAgent(sessionID)
  const agentKey = getAgentConfigKey(sessionAgent ?? "")
  const requiredAgentKey = getAgentConfigKey(requiredAgentName)
  const isEligibleSubagent =
    agentKey === requiredAgentKey
    || (requiredAgentKey === getAgentConfigKey("atlas") && agentKey === getAgentConfigKey("sisyphus"))

  if (!isEligibleSubagent) {
    return false
  }

  return isSessionInBoulderLineage({
    client,
    sessionID,
    boulderSessionIDs: boulder.session_ids,
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
