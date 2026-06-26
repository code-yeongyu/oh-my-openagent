import type { SessionState } from "./types"
import { readFinalWavePlanState } from "./final-wave-plan-state"

const VERDICT_PATTERN = /\bVERDICT:\s*(APPROVE|REJECT)\b/gi

export function classifyFinalWaveVerdict(output: string): "approve" | "reject" | "missing" {
  const verdicts = [...output.matchAll(VERDICT_PATTERN)].map((match) => match[1]?.toLowerCase())
  const hasApprove = verdicts.includes("approve")
  const hasReject = verdicts.includes("reject")

  if (hasApprove && !hasReject) {
    return "approve"
  }

  if (hasReject && !hasApprove) {
    return "reject"
  }

  return "missing"
}

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

  if (classifyFinalWaveVerdict(input.taskOutput) !== "approve") {
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
