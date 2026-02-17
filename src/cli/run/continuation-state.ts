import { getPlanProgress, readBoulderState } from "../../features/boulder-state"
import { readState as readRalphLoopState } from "../../hooks/ralph-loop/storage"

export interface ContinuationState {
  hasActiveBoulder: boolean
  hasActiveRalphLoop: boolean
}

export function getContinuationState(directory: string, sessionID: string): ContinuationState {
  return {
    hasActiveBoulder: hasActiveBoulderContinuation(directory, sessionID),
    hasActiveRalphLoop: hasActiveRalphLoopContinuation(directory, sessionID),
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
