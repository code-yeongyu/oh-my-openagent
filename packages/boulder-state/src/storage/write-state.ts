import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { BoulderState, BoulderWorkState } from "../types"
import { getBoulderFilePath } from "./path"
import { getPlanName } from "./plan-progress"
import { getBoulderWorks, readBoulderState } from "./read-state"
import { getElapsedMs, normalizeSessionId, nowIsoString, projectWorkToMirror } from "./shared"

export function writeBoulderState(directory: string, state: BoulderState): boolean {
  const filePath = getBoulderFilePath(directory)
  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      // Self-ignoring .gitignore - excludes rules/ which is tracked in git
      writeFileSync(join(dir, ".gitignore"), ["*", "!/rules/", "!/rules/**", ""].join("\n"), "utf-8")
    }

    const stateToWrite: BoulderState = { ...state }
    if (stateToWrite.works && stateToWrite.active_work_id) {
      const activeWork = stateToWrite.works[stateToWrite.active_work_id]
      if (activeWork) {
        stateToWrite.works = {
          ...stateToWrite.works,
          [stateToWrite.active_work_id]: {
            ...activeWork,
            active_plan: stateToWrite.active_plan,
            plan_name: stateToWrite.plan_name,
            status: stateToWrite.status,
            started_at: stateToWrite.started_at,
            ended_at: stateToWrite.ended_at,
            elapsed_ms: stateToWrite.elapsed_ms,
            updated_at: stateToWrite.updated_at,
            session_ids: [...stateToWrite.session_ids],
            session_origins: stateToWrite.session_origins ? { ...stateToWrite.session_origins } : {},
            agent: stateToWrite.agent,
            worktree_path: stateToWrite.worktree_path,
            task_sessions: stateToWrite.task_sessions ? { ...stateToWrite.task_sessions } : {},
          },
        }
      }
    }

    writeFileSync(filePath, JSON.stringify(stateToWrite, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}

export function clearBoulderState(directory: string): boolean {
  const filePath = getBoulderFilePath(directory)
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}

export function generateWorkId(planName: string): string {
  const slug = planName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  const randomHex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0")
  return `${slug.length > 0 ? slug : "work"}-${randomHex}`
}

export function createBoulderState(planPath: string, sessionId: string, agent?: string, worktreePath?: string): BoulderState {
  const startedAt = nowIsoString()
  const normalizedSessionId = normalizeSessionId(sessionId)
  const workId = generateWorkId(getPlanName(planPath))
  const work: BoulderWorkState = {
    work_id: workId,
    active_plan: planPath,
    plan_name: getPlanName(planPath),
    status: "active",
    started_at: startedAt,
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    ...(agent !== undefined ? { agent } : {}),
    ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
    task_sessions: {},
  }

  return {
    schema_version: 2,
    active_work_id: workId,
    works: { [workId]: work },
    active_plan: planPath,
    started_at: startedAt,
    status: "active",
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    plan_name: getPlanName(planPath),
    task_sessions: {},
    ...(agent !== undefined ? { agent } : {}),
    ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
  }
}

export function selectActiveWork(directory: string, workId: string): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  const works = getBoulderWorks(state)
  const nextWork = works.find((work) => work.work_id === workId)
  if (!nextWork) {
    return null
  }

  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    active_work_id: workId,
    works: state.works ?? Object.fromEntries(works.map((work) => [work.work_id, work])),
  }
  projectWorkToMirror(nextState, nextWork)
  return writeBoulderState(directory, nextState) ? nextState : null
}

export function addBoulderWork(
  directory: string,
  input: { planPath: string; sessionId: string; agent?: string; worktreePath?: string; startedAt?: string },
): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  const workId = generateWorkId(getPlanName(input.planPath))
  const startedAt = input.startedAt ?? nowIsoString()
  const normalizedSessionId = normalizeSessionId(input.sessionId)
  const nextWork: BoulderWorkState = {
    work_id: workId,
    active_plan: input.planPath,
    plan_name: getPlanName(input.planPath),
    status: "active",
    started_at: startedAt,
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.worktreePath !== undefined ? { worktree_path: input.worktreePath } : {}),
    task_sessions: {},
  }

  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: { ...Object.fromEntries(getBoulderWorks(state).map((work) => [work.work_id, work])), [workId]: nextWork },
    active_work_id: workId,
  }
  projectWorkToMirror(nextState, nextWork)
  return writeBoulderState(directory, nextState) ? nextState : null
}

export function completeBoulder(directory: string, workId?: string, endedAt?: string): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  const targetWorkId = workId ?? state.active_work_id
  if (!targetWorkId) {
    return null
  }

  const work = state.works?.[targetWorkId] ?? getBoulderWorks(state).find((candidate) => candidate.work_id === targetWorkId)
  if (!work) {
    return null
  }

  if (work.status === "completed" && work.ended_at !== undefined && work.elapsed_ms !== undefined) {
    return state
  }

  const endAt = endedAt ?? nowIsoString()
  work.ended_at = endAt
  work.elapsed_ms = getElapsedMs(work.started_at, endAt)
  work.status = "completed"
  work.updated_at = nowIsoString()

  if (state.active_work_id === targetWorkId) {
    projectWorkToMirror(state, work)
  }

  return writeBoulderState(directory, state) ? state : null
}
