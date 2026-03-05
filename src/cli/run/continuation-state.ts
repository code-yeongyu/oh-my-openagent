import { getPlanProgress, readBoulderState } from "../../features/boulder-state"
import {
  getActiveContinuationMarkerReason,
  isContinuationMarkerActive,
  readContinuationMarker,
} from "../../features/run-continuation-state"
import { readState as readRalphLoopState } from "../../hooks/ralph-loop/storage"

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
  const boulder = readBoulderState(directory)
  if (!boulder) return false
  if (!boulder.session_ids.includes(sessionID)) return false

  const progress = getPlanProgress(boulder.active_plan)
  return !progress.isComplete
}

function hasActiveRalphLoopContinuation(directory: string, sessionID: string): boolean {
  const state = readRalphLoopState(directory)
  if (!state || !state.active) return false

  if (state.session_id && state.session_id !== sessionID) {
    return false
  }

  return true
}
