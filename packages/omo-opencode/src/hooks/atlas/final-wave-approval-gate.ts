import type { SessionState } from "./types"
import { readFinalWavePlanState } from "./final-wave-plan-state"

const APPROVE_VERDICT_PATTERN = /\bVERDICT:\s*APPROVE\b/i

function clearFinalWaveApprovalTracking(sessionState: SessionState): void {
  sessionState.pendingFinalWaveTaskCount = undefined
  sessionState.approvedFinalWaveTaskCount = undefined
}

export function shouldPauseForFinalWaveApproval(input: {
  planPath: string
  taskOutput: string
  sessionState: SessionState
}): boolean {
  const planState = readFinalWavePlanState(input.planPath)
  if (!planState) {
    return false
  }

  if (planState.pendingImplementationTaskCount > 0 || planState.pendingFinalWaveTaskCount === 0) {
    clearFinalWaveApprovalTracking(input.sessionState)
    return false
  }

  if (!APPROVE_VERDICT_PATTERN.test(input.taskOutput)) {
    return false
  }

  if (planState.pendingFinalWaveTaskCount === 1) {
    clearFinalWaveApprovalTracking(input.sessionState)
    return true
  }

  if (input.sessionState.pendingFinalWaveTaskCount !== planState.pendingFinalWaveTaskCount) {
    input.sessionState.pendingFinalWaveTaskCount = planState.pendingFinalWaveTaskCount
    input.sessionState.approvedFinalWaveTaskCount = 0
  }

  input.sessionState.approvedFinalWaveTaskCount = (input.sessionState.approvedFinalWaveTaskCount ?? 0) + 1
  const shouldPause = input.sessionState.approvedFinalWaveTaskCount >= planState.pendingFinalWaveTaskCount
  if (shouldPause) {
    clearFinalWaveApprovalTracking(input.sessionState)
  }

  return shouldPause
}
