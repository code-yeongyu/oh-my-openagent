import {
  findPrometheusPlans,
  getPlanProgress,
} from "../../features/boulder-state"
import type { BoulderState, BoulderWorkResumeOption } from "../../features/boulder-state"
import { buildAutoSelectedPlanContextWithStateInit } from "./work-initializer"
import { formatIncompletePlanList, pickPreferredIncompletePlan } from "./plan-selection"

export function shouldResumeExistingState(input: {
  readonly existingState: BoulderState | null
  readonly preferredPlanPath: string | null
}): boolean {
  const { existingState, preferredPlanPath } = input
  if (!existingState) {
    return false
  }

  if (getPlanProgress(existingState.active_plan).isComplete) {
    return false
  }

  if (preferredPlanPath && existingState.active_plan !== preferredPlanPath) {
    return false
  }

  return true
}

export function shouldDiscoverPlans(input: {
  readonly existingState: BoulderState | null
  readonly explicitPlanName: string | null
  readonly preferredPlanPath: string | null
}): boolean {
  const { existingState, explicitPlanName, preferredPlanPath } = input
  return !explicitPlanName && !shouldResumeExistingState({ existingState, preferredPlanPath })
}

export function shouldResumeSingleWorkOption(input: {
  readonly directory: string
  readonly option: BoulderWorkResumeOption
  readonly preferredPlanPath: string | null
}): boolean {
  const { directory, option, preferredPlanPath } = input
  if (!preferredPlanPath || option.active_plan === preferredPlanPath) {
    return true
  }

  return !findPrometheusPlans(directory).some(
    (planPath) => planPath === preferredPlanPath && !getPlanProgress(planPath).isComplete,
  )
}

export function buildPlanDiscoveryContext(params: {
  readonly contextInfo: string
  readonly sessionId: string
  readonly timestamp: string
  readonly activeAgent: string
  readonly worktreePath: string | undefined
  readonly worktreeBlock: string
  readonly directory: string
  readonly preferredPlanPath: string | null
}): string {
  const {
    contextInfo,
    sessionId,
    timestamp,
    activeAgent,
    worktreePath,
    worktreeBlock,
    directory,
    preferredPlanPath,
  } = params
  const plans = findPrometheusPlans(directory)
  const incompletePlans = plans.filter((planPath) => !getPlanProgress(planPath).isComplete)
  const preferredIncompletePlan = pickPreferredIncompletePlan(incompletePlans, preferredPlanPath)

  if (plans.length === 0) {
    return contextInfo + `
## No Plans Found

 No Prometheus plan files found in the .omo plans directory.
 Use the Prometheus agent to create a work plan first.`
  }

  if (incompletePlans.length === 0) {
    return contextInfo + `

## All Plans Complete

 All ${plans.length} plan(s) are complete. Create a new plan using the Prometheus agent.`
  }

  if (preferredIncompletePlan) {
    return contextInfo + buildAutoSelectedPlanContextWithStateInit({
      planPath: preferredIncompletePlan,
      sessionId,
      timestamp,
      activeAgent,
      worktreePath,
      worktreeBlock,
      directory,
      reason: "Most recently referenced plan in this session",
    })
  }

  if (incompletePlans.length === 1) {
    return contextInfo + buildAutoSelectedPlanContextWithStateInit({
      planPath: incompletePlans[0],
      sessionId,
      timestamp,
      activeAgent,
      worktreePath,
      worktreeBlock,
      directory,
    })
  }

  return contextInfo + `

<system-reminder>
## Multiple Plans Found

Current Time: ${timestamp}
Session ID: ${sessionId}

${formatIncompletePlanList(incompletePlans, true)}

Ask the user which plan to work on. Present the options above and wait for their response.
${worktreeBlock}
</system-reminder>`
}
