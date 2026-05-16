/**
 * Boulder State Storage
 *
 * Handles reading/writing boulder.json for active plan tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import type {
  BoulderSessionOrigin,
  BoulderState,
  BoulderWorkResumeOption,
  BoulderWorkState,
  BoulderWorkStatus,
  PlanProgress,
  TaskSessionState,
} from "./types"
import { BOULDER_DIR, BOULDER_FILE, PROMETHEUS_PLANS_DIR } from "./constants"

const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"])

function nowIsoString(): string {
  return new Date().toISOString()
}

function parseIsoToMs(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function getElapsedMs(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  const startedMs = parseIsoToMs(startedAt)
  const endedMs = parseIsoToMs(endedAt)
  if (startedMs === null || endedMs === null) {
    return undefined
  }

  return endedMs - startedMs
}

function isValidWorkStatus(status: unknown): status is BoulderWorkStatus {
  return status === "active" || status === "completed" || status === "paused" || status === "abandoned"
}

function buildWorkFromMirror(state: BoulderState): BoulderWorkState {
  const planName = state.plan_name ?? getPlanName(state.active_plan)
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
    session_ids: Array.isArray(state.session_ids) ? [...state.session_ids] : [],
    session_origins: state.session_origins,
    agent: state.agent,
    worktree_path: state.worktree_path,
    task_sessions: state.task_sessions,
  }
}

function projectWorkToMirror(state: BoulderState, work: BoulderWorkState): void {
  state.active_plan = work.active_plan
  state.plan_name = work.plan_name
  state.status = work.status
  state.started_at = work.started_at
  state.ended_at = work.ended_at
  state.elapsed_ms = work.elapsed_ms
  state.updated_at = work.updated_at
  state.session_ids = [...work.session_ids]
  state.session_origins = work.session_origins ? { ...work.session_origins } : {}
  state.agent = work.agent
  state.worktree_path = work.worktree_path
  state.task_sessions = work.task_sessions ? { ...work.task_sessions } : {}
}

function selectMirrorWork(state: BoulderState): BoulderWorkState | null {
  const works = getBoulderWorks(state)
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

export function getBoulderFilePath(directory: string): string {
  return join(directory, BOULDER_DIR, BOULDER_FILE)
}

function resolveTrackedPath(baseDirectory: string, trackedPath: string): string {
  return isAbsolute(trackedPath)
    ? resolve(trackedPath)
    : resolve(baseDirectory, trackedPath)
}

export function resolveBoulderPlanPath(
  directory: string,
  state: Pick<BoulderState, "active_plan" | "worktree_path">,
): string {
  const absolutePlanPath = resolveTrackedPath(directory, state.active_plan)
  const worktreePath = state.worktree_path?.trim()
  if (!worktreePath) {
    return absolutePlanPath
  }

  const absoluteDirectory = resolve(directory)
  const relativePlanPath = relative(absoluteDirectory, absolutePlanPath)
  if (
    relativePlanPath.length === 0
    || relativePlanPath.startsWith("..")
    || isAbsolute(relativePlanPath)
  ) {
    return absolutePlanPath
  }

  const absoluteWorktreePath = resolveTrackedPath(directory, worktreePath)
  const worktreePlanPath = resolve(absoluteWorktreePath, relativePlanPath)
  return existsSync(worktreePlanPath)
    ? worktreePlanPath
    : absolutePlanPath
}

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
    if (!Array.isArray(parsed.session_ids)) {
      parsed.session_ids = []
    }
    if (!parsed.session_origins || typeof parsed.session_origins !== "object" || Array.isArray(parsed.session_origins)) {
      parsed.session_origins = {}
    }
    if (parsed.session_ids.length === 1) {
      const soleSessionId = parsed.session_ids[0]
      if (
        typeof soleSessionId === "string"
        && parsed.session_origins[soleSessionId] !== "appended"
        && parsed.session_origins[soleSessionId] !== "direct"
      ) {
        parsed.session_origins[soleSessionId] = "direct"
      }
    }
    if (!parsed.task_sessions || typeof parsed.task_sessions !== "object" || Array.isArray(parsed.task_sessions)) {
      parsed.task_sessions = {}
    }

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

export function writeBoulderState(directory: string, state: BoulderState): boolean {
  const filePath = getBoulderFilePath(directory)

  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const stateToWrite: BoulderState = { ...state }
    if (stateToWrite.works && stateToWrite.active_work_id) {
      const activeWork = stateToWrite.works[stateToWrite.active_work_id]
      if (activeWork) {
        const nextActiveWork: BoulderWorkState = {
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
        }
        stateToWrite.works = {
          ...stateToWrite.works,
          [stateToWrite.active_work_id]: nextActiveWork,
        }
      }
    }

    writeFileSync(filePath, JSON.stringify(stateToWrite, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}

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
  if (!state) return null

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

export function clearBoulderState(directory: string): boolean {
  const filePath = getBoulderFilePath(directory)

  try {
    if (existsSync(filePath)) {
      const { unlinkSync } = require("node:fs")
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
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
  if (!state) {
    return null
  }

  if (RESERVED_KEYS.has(input.taskKey)) {
    return null
  }

  const taskSessions = state.task_sessions ?? {}
  taskSessions[input.taskKey] = {
    task_key: input.taskKey,
    task_label: input.taskLabel,
    task_title: input.taskTitle,
    session_id: input.sessionId,
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    updated_at: new Date().toISOString(),
  }

  state.task_sessions = taskSessions
  if (writeBoulderState(directory, state)) {
    return state
  }

  return null
}

/**
 * Find Prometheus plan files for this project.
 * Prometheus stores plans at: {project}/.omo/plans/{name}.md
 */
export function findPrometheusPlans(directory: string): string[] {
  const plansDir = join(directory, PROMETHEUS_PLANS_DIR)

  if (!existsSync(plansDir)) {
    return []
  }

  try {
    const files = readdirSync(plansDir)
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(plansDir, f))
      .sort((a, b) => {
        // Sort by modification time, newest first
        const aStat = require("node:fs").statSync(a)
        const bStat = require("node:fs").statSync(b)
        return bStat.mtimeMs - aStat.mtimeMs
      })
  } catch {
    return []
  }
}

const TODO_HEADING_PATTERN = /^##\s+TODOs\b/i
const FINAL_VERIFICATION_HEADING_PATTERN = /^##\s+Final Verification Wave\b/i
const SECOND_LEVEL_HEADING_PATTERN = /^##\s+/
const UNCHECKED_CHECKBOX_PATTERN = /^(\s*)[-*]\s*\[\s*\]\s*(.+)$/
const CHECKED_CHECKBOX_PATTERN = /^(\s*)[-*]\s*\[[xX]\]\s*(.+)$/
const TODO_TASK_PATTERN = /^\d+\.\s+/
const FINAL_WAVE_TASK_PATTERN = /^F\d+\.\s+/i

type ProgressSection = "todo" | "final-wave" | "other"

/**
 * Parse a plan file and count checkbox progress.
 *
 * Only top-level (zero-indent) checkboxes under `## TODOs` and
 * `## Final Verification Wave` sections are counted. The checkbox
 * body must carry a valid task label (`N.` for TODOs, `FN.` for
 * Final Verification Wave). Nested acceptance-criteria checkboxes
 * and checkboxes in other sections are intentionally ignored so
 * that progress tracking stays aligned with `readCurrentTopLevelTask`.
 */
export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: false }
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    const lines = content.split(/\r?\n/)

    // Check if the plan has structured sections (## TODOs / ## Final Verification Wave)
    const hasStructuredSections = lines.some(
      (line) => TODO_HEADING_PATTERN.test(line) || FINAL_VERIFICATION_HEADING_PATTERN.test(line),
    )

    if (hasStructuredSections) {
      // Structured plan: only count top-level checkboxes with numbered labels
      // under ## TODOs and ## Final Verification Wave sections
      return getStructuredPlanProgress(lines)
    }

    // Simple plan: count all top-level checkboxes anywhere
    return getSimplePlanProgress(content)
  } catch {
    return { total: 0, completed: 0, isComplete: false }
  }
}

function getStructuredPlanProgress(lines: string[]): PlanProgress {
  let section: ProgressSection = "other"
  let total = 0
  let completed = 0

  for (const line of lines) {
    if (SECOND_LEVEL_HEADING_PATTERN.test(line)) {
      section = TODO_HEADING_PATTERN.test(line)
        ? "todo"
        : FINAL_VERIFICATION_HEADING_PATTERN.test(line)
          ? "final-wave"
          : "other"
      continue
    }

    if (section !== "todo" && section !== "final-wave") {
      continue
    }

    const checkedMatch = line.match(CHECKED_CHECKBOX_PATTERN)
    const uncheckedMatch = checkedMatch ? null : line.match(UNCHECKED_CHECKBOX_PATTERN)
    const match = checkedMatch ?? uncheckedMatch
    if (!match) {
      continue
    }

    if (match[1].length > 0) {
      continue
    }

    const taskBody = match[2].trim()
    const labelPattern = section === "todo" ? TODO_TASK_PATTERN : FINAL_WAVE_TASK_PATTERN
    if (!labelPattern.test(taskBody)) {
      continue
    }

    total++
    if (checkedMatch) {
      completed++
    }
  }

  return {
    total,
    completed,
    isComplete: total > 0 && completed === total,
  }
}

function getSimplePlanProgress(content: string): PlanProgress {
  const uncheckedMatches = content.match(/^[-*]\s*\[\s*\]/gm) || []
  const checkedMatches = content.match(/^[-*]\s*\[[xX]\]/gm) || []

  const total = uncheckedMatches.length + checkedMatches.length
  const completed = checkedMatches.length

  return {
    total,
    completed,
    isComplete: total > 0 && completed === total,
  }
}

/**
 * Extract plan name from file path.
 */
export function getPlanName(planPath: string): string {
  return basename(planPath, ".md")
}

/**
 * Create a new boulder state for a plan.
 */
export function createBoulderState(
  planPath: string,
  sessionId: string,
  agent?: string,
  worktreePath?: string,
): BoulderState {
  const startedAt = nowIsoString()
  const workId = generateWorkId(getPlanName(planPath))
  const work: BoulderWorkState = {
    work_id: workId,
    active_plan: planPath,
    plan_name: getPlanName(planPath),
    status: "active",
    started_at: startedAt,
    updated_at: startedAt,
    session_ids: [sessionId],
    session_origins: {
      [sessionId]: "direct",
    },
    ...(agent !== undefined ? { agent } : {}),
    ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
    task_sessions: {},
  }

  return {
    schema_version: 2,
    active_work_id: workId,
    works: {
      [workId]: work,
    },
    active_plan: planPath,
    started_at: startedAt,
    status: "active",
    updated_at: startedAt,
    session_ids: [sessionId],
    session_origins: {
      [sessionId]: "direct",
    },
    plan_name: getPlanName(planPath),
    task_sessions: {},
    ...(agent !== undefined ? { agent } : {}),
    ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
  }
}

export function generateWorkId(planName: string): string {
  const slug = planName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const randomHex = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0")
  const safeSlug = slug.length > 0 ? slug : "work"
  return `${safeSlug}-${randomHex}`
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

    if (!worktreePath) {
      return true
    }

    return work.worktree_path === worktreePath
  }) ?? null
}

export function getWorkForSession(directory: string, sessionId: string): BoulderWorkState | null {
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  const works = getBoulderWorks(state)
    .filter((work) => work.session_ids.includes(sessionId))
    .sort((left, right) => {
      const leftMs = parseIsoToMs(left.updated_at ?? left.started_at) ?? 0
      const rightMs = parseIsoToMs(right.updated_at ?? right.started_at) ?? 0
      return rightMs - leftMs
    })

  if (works.length > 0) {
    return works[0] ?? null
  }

  if (state.session_ids.includes(sessionId)) {
    return buildWorkFromMirror(state)
  }

  return null
}

export function resolveBoulderPlanPathForWork(
  directory: string,
  work: Pick<BoulderWorkState, "active_plan" | "worktree_path">,
): string {
  return resolveBoulderPlanPath(directory, work)
}

export function getWorkResumeOptions(directory: string): BoulderWorkResumeOption[] {
  const state = readBoulderState(directory)
  if (!state) {
    return []
  }

  return getActiveWorks(directory).map((work) => {
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

  if (!writeBoulderState(directory, nextState)) {
    return null
  }

  return nextState
}

export function addBoulderWork(
  directory: string,
  input: {
    planPath: string
    sessionId: string
    agent?: string
    worktreePath?: string
    startedAt?: string
  },
): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  const workId = generateWorkId(getPlanName(input.planPath))
  const startedAt = input.startedAt ?? nowIsoString()
  const nextWork: BoulderWorkState = {
    work_id: workId,
    active_plan: input.planPath,
    plan_name: getPlanName(input.planPath),
    status: "active",
    started_at: startedAt,
    updated_at: startedAt,
    session_ids: [input.sessionId],
    session_origins: {
      [input.sessionId]: "direct",
    },
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.worktreePath !== undefined ? { worktree_path: input.worktreePath } : {}),
    task_sessions: {},
  }

  const works = getBoulderWorks(state)
  const nextWorks: Record<string, BoulderWorkState> = {
    ...Object.fromEntries(works.map((work) => [work.work_id, work])),
    [workId]: nextWork,
  }

  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: nextWorks,
    active_work_id: workId,
  }
  projectWorkToMirror(nextState, nextWork)

  if (!writeBoulderState(directory, nextState)) {
    return null
  }

  return nextState
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

  const sessionIds = targetWork.session_ids.includes(sessionId)
    ? [...targetWork.session_ids]
    : [...targetWork.session_ids, sessionId]
  const sessionOrigins = {
    ...(targetWork.session_origins ?? {}),
    [sessionId]: origin,
  }

  const updatedWork: BoulderWorkState = {
    ...targetWork,
    session_ids: sessionIds,
    session_origins: sessionOrigins,
    updated_at: nowIsoString(),
  }
  const nextWorks = {
    ...Object.fromEntries(works.map((work) => [work.work_id, work])),
    [workId]: updatedWork,
  }

  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: nextWorks,
  }
  if (state.active_work_id === workId) {
    projectWorkToMirror(nextState, updatedWork)
  }

  if (!writeBoulderState(directory, nextState)) {
    return null
  }

  return nextState
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

  const previousTaskSession = targetWork.task_sessions?.[input.taskKey]
  const nextTaskSession: TaskSessionState = {
    task_key: input.taskKey,
    task_label: input.taskLabel,
    task_title: input.taskTitle,
    session_id: input.sessionId,
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
    task_sessions: {
      ...(targetWork.task_sessions ?? {}),
      [input.taskKey]: nextTaskSession,
    },
    updated_at: nowIsoString(),
  }

  const nextWorks = {
    ...Object.fromEntries(works.map((work) => [work.work_id, work])),
    [workId]: nextWork,
  }

  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: nextWorks,
  }
  if (state.active_work_id === workId) {
    projectWorkToMirror(nextState, nextWork)
  }

  if (!writeBoulderState(directory, nextState)) {
    return null
  }

  return nextState
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
  const nextState = upsertTaskSessionStateForWork(directory, workId, input)
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

  if (!writeBoulderState(directory, nextState)) {
    return null
  }

  return nextState
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

  if (!writeBoulderState(directory, state)) {
    return null
  }

  return state
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

  if (!writeBoulderState(directory, state)) {
    return null
  }

  return state
}
