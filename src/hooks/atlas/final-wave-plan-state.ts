import { readPlanExecutionSummary } from "../../features/boulder-state"

export type FinalWavePlanState = {
  pendingImplementationTaskCount: number
  pendingFinalWaveTaskCount: number
}

export function readFinalWavePlanState(planPath: string): FinalWavePlanState | null {
  const summary = readPlanExecutionSummary(planPath)
  if (!summary) {
    return null
  }

  return {
    pendingImplementationTaskCount: summary.pendingImplementationTaskCount,
    pendingFinalWaveTaskCount: summary.pendingFinalWaveTaskCount,
  }
}
