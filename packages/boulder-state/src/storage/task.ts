import type { BoulderState, BoulderWorkState, TaskSessionState } from "../types"
import { getBoulderWorks, readBoulderState } from "./read-state"
import { getElapsedMs, normalizeSessionId, nowIsoString, projectWorkToMirror, RESERVED_KEYS } from "./shared"
import { writeBoulderState } from "./write-state"

export function upsertTaskSessionState(
  directory: string,
  input: {
    taskKey: string
    taskLabel: string
    taskTitle: string
    sessionId: string
    agent?: string
    category?: string
  },
): BoulderState | null {
  const stateForWork = readBoulderState(directory)
  if (stateForWork?.active_work_id) {
    return upsertTaskSessionStateForWork(directory, stateForWork.active_work_id, input)
  }

  const state = readBoulderState(directory)
  if (!state || RESERVED_KEYS.has(input.taskKey)) {
    return null
  }

  const normalizedSessionId = normalizeSessionId(input.sessionId)
  const taskSessions = state.task_sessions ?? {}
  taskSessions[input.taskKey] = {
    task_key: input.taskKey,
    task_label: input.taskLabel,
    task_title: input.taskTitle,
    session_id: normalizedSessionId,
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    updated_at: nowIsoString(),
  }

  state.task_sessions = taskSessions
  return writeBoulderState(directory, state) ? state : null
}

export function upsertTaskSessionStateForWork(
  directory: string,
  workId: string,
  input: {
    taskKey: string
    taskLabel: string
    taskTitle: string
    sessionId: string
    agent?: string
    category?: string
  },
): BoulderState | null {
  if (RESERVED_KEYS.has(input.taskKey)) {
    return null
  }

  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  const works = getBoulderWorks(state)
  const targetWork = works.find((work) => work.work_id === workId)
  if (!targetWork) {
    return null
  }

  const normalizedSessionId = normalizeSessionId(input.sessionId)
  const previousTaskSession = targetWork.task_sessions?.[input.taskKey]
  const nextTaskSession: TaskSessionState = {
    task_key: input.taskKey,
    task_label: input.taskLabel,
    task_title: input.taskTitle,
    session_id: normalizedSessionId,
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(previousTaskSession?.started_at !== undefined ? { started_at: previousTaskSession.started_at } : {}),
    ...(previousTaskSession?.ended_at !== undefined ? { ended_at: previousTaskSession.ended_at } : {}),
    ...(previousTaskSession?.elapsed_ms !== undefined ? { elapsed_ms: previousTaskSession.elapsed_ms } : {}),
    ...(previousTaskSession?.status !== undefined ? { status: previousTaskSession.status } : {}),
    updated_at: nowIsoString(),
  }

  const nextWork: BoulderWorkState = {
    ...targetWork,
    task_sessions: { ...(targetWork.task_sessions ?? {}), [input.taskKey]: nextTaskSession },
    updated_at: nowIsoString(),
  }

  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: {
      ...Object.fromEntries(works.map((work) => [work.work_id, work])),
      [workId]: nextWork,
    },
  }

  if (state.active_work_id === workId) {
    projectWorkToMirror(nextState, nextWork)
  }

  return writeBoulderState(directory, nextState) ? nextState : null
}

export function startTaskTimer(
  directory: string,
  workId: string,
  input: {
    taskKey: string
    taskLabel: string
    taskTitle: string
    sessionId: string
    agent?: string
    category?: string
    startedAt?: string
  },
): BoulderState | null {
  const nextState = upsertTaskSessionStateForWork(directory, workId, {
    ...input,
    sessionId: normalizeSessionId(input.sessionId),
  })
  if (!nextState) {
    return null
  }

  const work = nextState.works?.[workId]
  const taskSession = work?.task_sessions?.[input.taskKey]
  if (!work || !taskSession) {
    return null
  }

  const startedAt = taskSession.started_at ?? input.startedAt ?? nowIsoString()
  taskSession.started_at = startedAt
  taskSession.status = "running"
  taskSession.updated_at = nowIsoString()
  work.updated_at = nowIsoString()
  return writeBoulderState(directory, nextState) ? nextState : null
}

export function endTaskTimer(
  directory: string,
  workId: string,
  taskKey: string,
  endedAt?: string,
): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  const work = state.works?.[workId] ?? getBoulderWorks(state).find((candidate) => candidate.work_id === workId)
  if (!work?.task_sessions?.[taskKey]) {
    return null
  }

  const taskSession = work.task_sessions[taskKey]
  const endAt = endedAt ?? nowIsoString()
  taskSession.ended_at = endAt
  taskSession.elapsed_ms = getElapsedMs(taskSession.started_at, endAt)
  taskSession.status = "completed"
  taskSession.updated_at = nowIsoString()
  work.updated_at = nowIsoString()

  if (state.active_work_id === workId) {
    projectWorkToMirror(state, work)
  }

  return writeBoulderState(directory, state) ? state : null
}
