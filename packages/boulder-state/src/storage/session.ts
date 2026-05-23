import type { BoulderSessionOrigin, BoulderState, BoulderWorkState } from "../types"
import { getBoulderWorks, readBoulderState } from "./read-state"
import { nowIsoString, projectWorkToMirror } from "./shared"
import { writeBoulderState } from "./write-state"

export function appendSessionId(
  directory: string,
  sessionId: string,
  origin: "direct" | "appended" = "direct",
): BoulderState | null {
  const activeWorkId = readBoulderState(directory)?.active_work_id
  if (activeWorkId) {
    return appendSessionIdForWork(directory, activeWorkId, sessionId, origin)
  }

  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  if (!state.session_origins || typeof state.session_origins !== "object" || Array.isArray(state.session_origins)) {
    state.session_origins = {}
  }

  if (!state.session_ids?.includes(sessionId)) {
    if (!Array.isArray(state.session_ids)) {
      state.session_ids = []
    }

    const originalSessionIds = [...state.session_ids]
    const originalSessionOrigins = { ...state.session_origins }
    state.session_ids.push(sessionId)
    state.session_origins[sessionId] = origin
    if (writeBoulderState(directory, state)) {
      return state
    }

    state.session_ids = originalSessionIds
    state.session_origins = originalSessionOrigins
    return null
  }

  if (!state.session_origins[sessionId]) {
    state.session_origins[sessionId] = origin
    if (!writeBoulderState(directory, state)) {
      return null
    }
  }

  return state
}

export function appendSessionIdForWork(
  directory: string,
  workId: string,
  sessionId: string,
  origin: BoulderSessionOrigin = "direct",
): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  const works = getBoulderWorks(state)
  const targetWork = works.find((work) => work.work_id === workId)
  if (!targetWork) {
    return null
  }

  const updatedWork: BoulderWorkState = {
    ...targetWork,
    session_ids: targetWork.session_ids.includes(sessionId)
      ? [...targetWork.session_ids]
      : [...targetWork.session_ids, sessionId],
    session_origins: { ...(targetWork.session_origins ?? {}), [sessionId]: origin },
    updated_at: nowIsoString(),
  }

  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: {
      ...Object.fromEntries(works.map((work) => [work.work_id, work])),
      [workId]: updatedWork,
    },
  }

  if (state.active_work_id === workId) {
    projectWorkToMirror(nextState, updatedWork)
  }

  return writeBoulderState(directory, nextState) ? nextState : null
}
