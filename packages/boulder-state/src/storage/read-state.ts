import { existsSync, readFileSync } from "node:fs"

import type { BoulderPauseReason, BoulderState, BoulderWorkResumeOption, BoulderWorkState, TaskSessionState } from "../types"
import { getBoulderFilePath, resolveBoulderPlanPathForWork } from "./path"
import { getPlanProgress } from "./plan-progress"
import { buildWorkFromMirror, isValidWorkStatus, normalizeSessionId, parseIsoToMs, projectWorkToMirror, selectMirrorWork } from "./shared"

export function readBoulderState(directory: string): BoulderState | null {
  const filePath = getBoulderFilePath(directory)
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
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
  normalizeSessionFields(state)

  const sessionIds = Array.isArray(state.session_ids) ? state.session_ids : []

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

  normalizeWorkSessionFields(state.works)
}

function normalizeSessionFields(target: Record<string, unknown>): void {
  const sessionIds = Array.isArray(target.session_ids)
    ? target.session_ids.filter((sessionId): sessionId is string => typeof sessionId === "string").map((sessionId) => normalizeSessionId(sessionId))
    : []
  target.session_ids = sessionIds

  const sessionOrigins = target.session_origins && typeof target.session_origins === "object" && !Array.isArray(target.session_origins)
    ? normalizeSessionOrigins(target.session_origins as Record<string, unknown>)
    : {}
  target.session_origins = sessionOrigins
}

function normalizeSessionOrigins(sessionOrigins: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(sessionOrigins).map(([sessionId, origin]) => [normalizeSessionId(sessionId), origin]),
  )
}

function normalizeWorkSessionFields(works: unknown): void {
  if (!works || typeof works !== "object" || Array.isArray(works)) {
    return
  }

  for (const work of Object.values(works)) {
    if (work && typeof work === "object" && !Array.isArray(work)) {
      normalizeSessionFields(work as Record<string, unknown>)
    }
  }
}

export function getBoulderWorks(state: BoulderState): BoulderWorkState[] {
  if (state.works && typeof state.works === "object") {
    return Object.values(state.works).filter((work): work is BoulderWorkState => work != null)
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

  const normalizedSessionId = normalizeSessionId(sessionId)
  let newestWork: BoulderWorkState | null = null
  let newestWorkMs = 0

  for (const work of getBoulderWorks(state)) {
    if (!work.session_ids.includes(normalizedSessionId)) {
      continue
    }

    const workMs = parseIsoToMs(work.updated_at ?? work.started_at) ?? 0
    if (!newestWork || workMs > newestWorkMs) {
      newestWork = work
      newestWorkMs = workMs
    }
  }

  if (newestWork) {
    return newestWork
  }

  return state.session_ids.includes(normalizedSessionId) ? buildWorkFromMirror(state) : null
}

export function isBoulderPausedForSession(
  directory: string,
  input: { sessionId: string; reason: BoulderPauseReason },
): boolean {
  const state = readBoulderState(directory)
  if (!state) {
    return false
  }

  const normalizedSessionId = normalizeSessionId(input.sessionId)
  const work = getWorkForSession(directory, input.sessionId)
  const pause = work?.pause ?? state.pause
  return pause?.reason === input.reason && pause.session_id === normalizedSessionId
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
