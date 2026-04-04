/**
 * Boulder State Storage
 *
 * Handles reading/writing boulder.json for active plan tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, join, basename } from "node:path"
import type { BoulderState, PlanProgress, TaskSessionState } from "./types"
import { BOULDER_DIR, BOULDER_FILE, PROMETHEUS_PLANS_DIR } from "./constants"

const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"])

export function getBoulderFilePath(directory: string): string {
  return join(directory, BOULDER_DIR, BOULDER_FILE)
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
    if (!parsed.task_sessions || typeof parsed.task_sessions !== "object" || Array.isArray(parsed.task_sessions)) {
      parsed.task_sessions = {}
    }
    return parsed as BoulderState
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

    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}

export function appendSessionId(directory: string, sessionId: string): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) return null

  if (!state.session_ids?.includes(sessionId)) {
    if (!Array.isArray(state.session_ids)) {
      state.session_ids = []
    }
    const originalSessionIds = [...state.session_ids]
    state.session_ids.push(sessionId)
    if (writeBoulderState(directory, state)) {
      return state
    }
    state.session_ids = originalSessionIds
    return null
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
 * Prometheus stores plans at: {project}/.sisyphus/plans/{name}.md
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

/**
 * Parse a plan file and count checkbox progress.
 */
export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: true }
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    
    // Match markdown checkboxes: - [ ] or - [x] or - [X]
    const uncheckedMatches = content.match(/^\s*[-*]\s*\[\s*\]/gm) || []
    const checkedMatches = content.match(/^\s*[-*]\s*\[[xX]\]/gm) || []

    const total = uncheckedMatches.length + checkedMatches.length
    const completed = checkedMatches.length

    return {
      total,
      completed,
      isComplete: total > 0 && completed === total,
    }
  } catch {
    return { total: 0, completed: 0, isComplete: true }
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
  return {
    active_plan: planPath,
    started_at: new Date().toISOString(),
    session_ids: [sessionId],
    plan_name: getPlanName(planPath),
    ...(agent !== undefined ? { agent } : {}),
    ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
  }
}
