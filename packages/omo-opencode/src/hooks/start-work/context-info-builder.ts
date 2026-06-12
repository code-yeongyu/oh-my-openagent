import {
  getActiveWorks,
  getPlanProgress,
  getWorkResumeOptions,
  readBoulderState,
  selectActiveWork,
} from "../../features/boulder-state"
import type { BoulderState } from "../../features/boulder-state"
import { log } from "../../shared/logger"
import type { PluginInput } from "@opencode-ai/plugin"
import { buildExistingSessionContext, buildMultipleActiveWorksContext } from "./context-info-formatters"
import { buildExplicitPlanContext } from "./explicit-plan-context"
import {
  buildPlanDiscoveryContext,
  shouldDiscoverPlans,
  shouldResumeExistingState,
  shouldResumeSingleWorkOption,
} from "./plan-discovery-context"
import { HOOK_NAME } from "./start-work-hook"

export function buildStartWorkContextInfo(params: {
  readonly ctx: PluginInput
  readonly explicitPlanName: string | null
  readonly existingState: ReturnType<typeof readBoulderState>
  readonly sessionId: string
  readonly timestamp: string
  readonly activeAgent: string
  readonly worktreePath: string | undefined
  readonly worktreeBlock: string
  readonly preferredPlanPath?: string | null
}): string {
  const {
    ctx,
    explicitPlanName,
    existingState,
    sessionId,
    timestamp,
    activeAgent,
    worktreePath,
    worktreeBlock,
    preferredPlanPath = null,
  } = params
  const directory = ctx.directory
  const resumeOptions = getWorkResumeOptions(directory).filter(
    (option) => option.status === "active" || option.status === "paused",
  )

  if (!explicitPlanName && resumeOptions.length > 1) {
    return buildMultipleActiveWorksContext({
      resumeOptions,
      sessionId,
      timestamp,
    })
  }

  if (!explicitPlanName && resumeOptions.length === 1) {
    const onlyOption = resumeOptions[0]
    if (shouldResumeSingleWorkOption({ directory, option: onlyOption, preferredPlanPath })) {
      const selectedState = selectActiveWork(directory, onlyOption.work_id)
      if (selectedState) {
        return buildExistingSessionContext({
          existingState: selectedState,
          sessionId,
          activeAgent,
          worktreePath,
          worktreeBlock,
          directory,
        })
      }
    }
  }

  if (!explicitPlanName && resumeOptions.length === 0 && getActiveWorks(directory).length === 0) {
    return buildPlanDiscoveryContext({
      contextInfo: "",
      sessionId,
      timestamp,
      activeAgent,
      worktreePath,
      worktreeBlock,
      directory,
      preferredPlanPath,
    })
  }

  const contextInfo = buildSelectedContextInfo({
    explicitPlanName,
    existingState,
    sessionId,
    timestamp,
    activeAgent,
    worktreePath,
    worktreeBlock,
    directory,
    preferredPlanPath,
  })

  if (shouldDiscoverPlans({ existingState, explicitPlanName, preferredPlanPath })) {
    return buildPlanDiscoveryContext({
      contextInfo,
      sessionId,
      timestamp,
      activeAgent,
      worktreePath,
      worktreeBlock,
      directory,
      preferredPlanPath,
    })
  }

  return contextInfo
}

function buildSelectedContextInfo(params: {
  readonly explicitPlanName: string | null
  readonly existingState: BoulderState | null
  readonly sessionId: string
  readonly timestamp: string
  readonly activeAgent: string
  readonly worktreePath: string | undefined
  readonly worktreeBlock: string
  readonly directory: string
  readonly preferredPlanPath: string | null
}): string {
  const {
    explicitPlanName,
    existingState,
    sessionId,
    timestamp,
    activeAgent,
    worktreePath,
    worktreeBlock,
    directory,
    preferredPlanPath,
  } = params

  if (explicitPlanName) {
    return buildExplicitPlanContext({
      explicitPlanName,
      sessionId,
      timestamp,
      activeAgent,
      worktreePath,
      worktreeBlock,
      directory,
    })
  }

  if (shouldResumeExistingState({ existingState, preferredPlanPath }) && existingState) {
    return buildExistingSessionContext({
      existingState,
      sessionId,
      activeAgent,
      worktreePath,
      worktreeBlock,
      directory,
    })
  }

  if (existingState && !getPlanProgress(existingState.active_plan).isComplete) {
    log(`[${HOOK_NAME}] Ignoring unrelated active boulder state for this session`, {
      sessionID: sessionId,
      activePlan: existingState.active_plan,
      preferredPlanPath,
    })
  }

  return ""
}
