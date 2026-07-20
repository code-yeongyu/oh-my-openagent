import type { BoulderState, BoulderWorkState, BoulderWorkStatus } from "../types"

export const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"])

// Bare session ids default to "opencode" for legacy compatibility.
// Senpi callers MUST pass pre-prefixed "senpi:<id>" to read APIs such as
// getWorkForSession, because the default platform remains "opencode".
type SessionPlatform = "codex" | "opencode" | "senpi"

const SESSION_ID_PREFIX_PATTERN = /^(codex|opencode|senpi):/

export function normalizeSessionId(sessionId: string, platform: SessionPlatform = "opencode"): string {
  if (SESSION_ID_PREFIX_PATTERN.test(sessionId)) {
    return sessionId
  }

  return `${platform}:${sessionId}`
}

export function nowIsoString(): string {
  return new Date().toISOString()
}

export function parseIsoToMs(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function getElapsedMs(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  const startedMs = parseIsoToMs(startedAt)
  const endedMs = parseIsoToMs(endedAt)
  if (startedMs === null || endedMs === null) {
    return undefined
  }

  return endedMs - startedMs
}

export function isValidWorkStatus(status: unknown): status is BoulderWorkStatus {
  return status === "active" || status === "completed" || status === "paused" || status === "abandoned"
}

export function buildWorkFromMirror(state: BoulderState): BoulderWorkState {
  const planName = state.plan_name ?? state.active_plan
  const workId = `${planName}-legacy`
  return {
    work_id: workId,
    active_plan: state.active_plan,
    plan_name: planName,
    status: state.status,
    started_at: state.started_at,
    ended_at: state.ended_at,
    elapsed_ms: state.elapsed_ms,
    updated_at: state.updated_at,
    pause: state.pause,
    session_ids: Array.isArray(state.session_ids) ? [...state.session_ids] : [],
    session_origins: state.session_origins,
    agent: state.agent,
    worktree_path: state.worktree_path,
    task_sessions: state.task_sessions,
  }
}

export function projectWorkToMirror(state: BoulderState, work: BoulderWorkState): void {
  state.active_plan = work.active_plan
  state.plan_name = work.plan_name
  state.status = work.status
  state.started_at = work.started_at
  state.ended_at = work.ended_at
  state.elapsed_ms = work.elapsed_ms
  state.updated_at = work.updated_at
  state.pause = work.pause
  state.session_ids = [...work.session_ids]
  state.session_origins = work.session_origins ? { ...work.session_origins } : {}
  state.agent = work.agent
  state.worktree_path = work.worktree_path
  state.task_sessions = work.task_sessions ? { ...work.task_sessions } : {}
}

export function selectMirrorWork(state: BoulderState): BoulderWorkState | null {
  const works = state.works ? Object.values(state.works) : []
  if (works.length === 0) {
    return null
  }

  if (state.active_work_id) {
    const matched = works.find((work) => work.work_id === state.active_work_id)
    if (matched) {
      return matched
    }
  }

  const sorted = [...works].sort((left, right) => {
    const leftMs = parseIsoToMs(left.updated_at ?? left.started_at) ?? 0
    const rightMs = parseIsoToMs(right.updated_at ?? right.started_at) ?? 0
    return rightMs - leftMs
  })
  return sorted[0] ?? null
}
