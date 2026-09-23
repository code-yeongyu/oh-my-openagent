import type { PluginInput } from "@opencode-ai/plugin"
import {
  getPlanProgress,
  getWorkForSession,
  normalizeSessionId,
  readBoulderState,
  resolveBoulderPlanPath,
  resolveBoulderPlanPathForWork,
} from "../../features/boulder-state"
import type { BoulderState, PlanProgress } from "../../features/boulder-state"

function isInactiveBoulderStatus(status: BoulderState["status"]): boolean {
  return status === "paused" || status === "abandoned"
}

function isCompletedBoulderState(state: BoulderState): boolean {
  return state.status === "completed" && state.ended_at !== undefined
}

export async function resolveActiveBoulderSession(input: {
  client: PluginInput["client"]
  directory: string
  sessionID: string
}): Promise<{
  boulderState: BoulderState
  progress: PlanProgress
  appendedSession: boolean
} | null> {
  const boulderState = readBoulderState(input.directory)
  if (!boulderState) {
    return null
  }

  const sessionWork = getWorkForSession(input.directory, input.sessionID)
  const normalizedSessionID = normalizeSessionId(input.sessionID)
  if (!sessionWork && !boulderState.session_ids.includes(normalizedSessionID)) {
    return null
  }

  const nextBoulderState: BoulderState = sessionWork
    ? {
        ...boulderState,
        active_plan: sessionWork.active_plan,
        plan_name: sessionWork.plan_name,
        status: sessionWork.status,
        started_at: sessionWork.started_at,
        ended_at: sessionWork.ended_at,
        elapsed_ms: sessionWork.elapsed_ms,
        updated_at: sessionWork.updated_at,
        session_ids: [...sessionWork.session_ids],
        session_origins: sessionWork.session_origins ? { ...sessionWork.session_origins } : {},
        agent: sessionWork.agent,
        worktree_path: sessionWork.worktree_path,
        task_sessions: sessionWork.task_sessions ? { ...sessionWork.task_sessions } : {},
      }
    : boulderState

  if (isInactiveBoulderStatus(nextBoulderState.status)) {
    return null
  }

  if (isCompletedBoulderState(nextBoulderState)) {
    return null
  }

  const progress = getPlanProgress(
    sessionWork
      ? resolveBoulderPlanPathForWork(input.directory, sessionWork)
      : resolveBoulderPlanPath(input.directory, nextBoulderState),
  )
  if (progress.isComplete) {
    return {
      boulderState: nextBoulderState,
      progress,
      appendedSession: nextBoulderState.session_origins?.[normalizedSessionID] === "appended",
    }
  }

  return {
    boulderState: nextBoulderState,
    progress,
    appendedSession: nextBoulderState.session_origins?.[normalizedSessionID] === "appended",
  }
}
