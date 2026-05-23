import { existsSync, readFileSync } from "node:fs"

import type { BoulderState, BoulderWorkResumeOption, BoulderWorkState, TaskSessionState } from "../types"
import { getBoulderFilePath, resolveBoulderPlanPathForWork } from "./path"
import { getPlanProgress } from "./plan-progress"
import { buildWorkFromMirror, isValidWorkStatus, parseIsoToMs, projectWorkToMirror, selectMirrorWork } from "./shared"

export function readBoulderState(directory: string): BoulderState | null {
  const filePath = getBoulderFilePath(directory)
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }

    normalizeState(parsed)
    const state = parsed as BoulderState
    const mirrorWork = selectMirrorWork(state)
    if (mirrorWork) {
      state.active_work_id = mirrorWork.work_id
      projectWorkToMirror(state, mirrorWork)
    }

    return state
  } catch {
    return null
  }
}

function normalizeState(state: Record<string, unknown>): void {
  const sessionIds = Array.isArray(state.session_ids) ? state.session_ids : []
  state.session_ids = sessionIds

  const sessionOrigins = state.session_origins && typeof state.session_origins === "object" && !Array.isArray(state.session_origins)
    ? (state.session_origins as Record<string, unknown>)
    : {}
  state.session_origins = sessionOrigins

  if (sessionIds.length === 1) {
    const soleSessionId = sessionIds[0]
    if (
      typeof soleSessionId === "string"
      && sessionOrigins[soleSessionId] !== "appended"
      && sessionOrigins[soleSessionId] !== "direct"
    ) {
      sessionOrigins[soleSessionId] = "direct"
    }
  }

  if (!state.task_sessions || typeof state.task_sessions !== "object" || Array.isArray(state.task_sessions)) {
    state.task_sessions = {}
  }
}

export function getBoulderWorks(state: BoulderState): BoulderWorkState[] {
  if (state.works && typeof state.works === "object") {
    return Object.values(state.works)
  }

  if (!state.active_plan || !state.plan_name || !state.started_at) {
    return []
  }

  return [buildWorkFromMirror(state)]
}

export function getActiveWorks(directory: string): BoulderWorkState[] {
  const state = readBoulderState(directory)
  if (!state) {
    return []
  }

  return getBoulderWorks(state).filter((work) => work.status !== "completed" && work.status !== "abandoned")
}

export function getWorkById(directory: string, workId: string): BoulderWorkState | null {
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  return getBoulderWorks(state).find((work) => work.work_id === workId) ?? null
}

export function getWorkByPlanName(
  directory: string,
  planName: string,
  options?: { worktreePath?: string },
): BoulderWorkState | null {
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  const worktreePath = options?.worktreePath
  return getBoulderWorks(state).find((work) => {
    if (work.plan_name !== planName) {
      return false
    }

    return worktreePath ? work.worktree_path === worktreePath : true
  }) ?? null
}

export function getWorkForSession(directory: string, sessionId: string): BoulderWorkState | null {
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  const works = getBoulderWorks(state)
    .filter((work) => work.session_ids.includes(sessionId))
    .sort((left, right) => (parseIsoToMs(right.updated_at ?? right.started_at) ?? 0) - (parseIsoToMs(left.updated_at ?? left.started_at) ?? 0))

  if (works.length > 0) {
    return works[0] ?? null
  }

  return state.session_ids.includes(sessionId) ? buildWorkFromMirror(state) : null
}

export function getWorkResumeOptions(directory: string): BoulderWorkResumeOption[] {
  const state = readBoulderState(directory)
  if (!state) {
    return []
  }

  return getBoulderWorks(state)
    .filter((work) => work.status !== "completed" && work.status !== "abandoned")
    .map((work) => {
      const progress = getPlanProgress(resolveBoulderPlanPathForWork(directory, work))
      return {
        work_id: work.work_id,
        plan_name: work.plan_name,
        active_plan: work.active_plan,
        worktree_path: work.worktree_path,
        status: work.status && isValidWorkStatus(work.status) ? work.status : "active",
        started_at: work.started_at,
        updated_at: work.updated_at ?? work.started_at,
        ended_at: work.ended_at,
        elapsed_ms: work.elapsed_ms,
        session_count: work.session_ids.length,
        progress,
        is_current_mirror: state.active_work_id === work.work_id,
      }
    })
}

export function getTaskSessionState(directory: string, taskKey: string): TaskSessionState | null {
  const state = readBoulderState(directory)
  if (state?.active_work_id) {
    const work = state.works?.[state.active_work_id]
    const taskSession = work?.task_sessions?.[taskKey]
    if (taskSession) {
      return taskSession
    }
  }

  if (!state?.task_sessions) {
    return null
  }

  return state.task_sessions[taskKey] ?? null
}
