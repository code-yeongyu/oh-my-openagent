import { getPlanProgress, findBoulderStateBySession } from "../../features/boulder-state"
import {
  getActiveContinuationMarkerReason,
  isContinuationMarkerActive,
  readContinuationMarker,
} from "../../features/run-continuation-state"
import { readStateForSession, findAnyActiveRalphLoopState, migrateLegacyRalphLoopState } from "../../hooks/ralph-loop/storage"

export interface ContinuationState {
  hasActiveBoulder: boolean
  hasActiveRalphLoop: boolean
  hasHookMarker: boolean
  hasTodoHookMarker: boolean
  hasActiveHookMarker: boolean
  activeHookMarkerReason: string | null
}

export function getContinuationState(directory: string, sessionID: string): ContinuationState {
  const marker = readContinuationMarker(directory, sessionID)

  return {
    hasActiveBoulder: hasActiveBoulderContinuation(directory, sessionID),
    hasActiveRalphLoop: hasActiveRalphLoopContinuation(directory, sessionID),
    hasHookMarker: marker !== null,
    hasTodoHookMarker: marker?.sources.todo !== undefined,
    hasActiveHookMarker: isContinuationMarkerActive(marker),
    activeHookMarkerReason: getActiveContinuationMarkerReason(marker),
  }
}

function hasActiveBoulderContinuation(directory: string, sessionID: string): boolean {
  const boulder = findBoulderStateBySession(directory, sessionID)
  if (!boulder) return false

  const progress = getPlanProgress(boulder.active_plan)
  return !progress.isComplete
}

function hasActiveRalphLoopContinuation(directory: string, sessionID: string): boolean {
  migrateLegacyRalphLoopState(directory)

  const sessionState = readStateForSession(directory, sessionID)
  if (sessionState?.active) return true

  const anyActive = findAnyActiveRalphLoopState(directory)
  if (!anyActive || !anyActive.active) return false

  if (anyActive.session_id && anyActive.session_id !== sessionID) {
    return false
  }

  return true
}
