/**
 * Boulder State Storage
 *
 * Legacy-compatible wrappers that delegate to per-plan storage.
 * New code should use per-plan-storage.ts functions directly.
 */

import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join, basename } from "node:path"
import type { BoulderState, PlanProgress } from "./types"
import { BOULDER_DIR, BOULDER_FILE, PROMETHEUS_PLANS_DIR } from "./constants"
import { parseBoulderJson } from "./boulder-json-parser"
import { migrateLegacyBoulderState } from "./legacy-migration"
import { atomicWriteJson } from "./atomic-file-ops"
import {
  listActiveBoulderStates,
  writeBoulderStateForPlan,
  appendSessionIdForPlan,
  clearBoulderStateForPlan,
} from "./per-plan-storage"
export function getBoulderFilePath(directory: string): string {
  return join(directory, BOULDER_DIR, BOULDER_FILE)
}

/**
 * Legacy-compatible read: tries per-plan states first, then migrates singleton.
 * Returns the first active boulder state found, or null.
 */
export function readBoulderState(directory: string): BoulderState | null {
  const perPlanStates = listActiveBoulderStates(directory)
  if (perPlanStates.length > 0) {
    return perPlanStates[0]
  }

  const migrated = migrateLegacyBoulderState(directory)
  if (migrated) return migrated

  return parseBoulderJson(getBoulderFilePath(directory))
}

/**
 * Legacy-compatible write: writes to per-plan storage if plan_name is available,
 * otherwise falls back to singleton for backward compat.
 */
export function writeBoulderState(directory: string, state: BoulderState): boolean {
  if (state.plan_name) {
    return writeBoulderStateForPlan(directory, state.plan_name, state)
  }

  try {
    atomicWriteJson(getBoulderFilePath(directory), state)
    return true
  } catch {
    return false
  }
}

/**
 * Legacy-compatible append: finds the state, then appends via per-plan if possible.
 */
export function appendSessionId(directory: string, sessionId: string): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) return null

  if (state.plan_name) {
    return appendSessionIdForPlan(directory, state.plan_name, sessionId)
  }

  if (!state.session_ids?.includes(sessionId)) {
    if (!Array.isArray(state.session_ids)) {
      state.session_ids = []
    }
    state.session_ids.push(sessionId)
    if (writeBoulderState(directory, state)) {
      return state
    }
  }

  return state
}

/**
 * Legacy-compatible clear: clears per-plan state if plan_name exists in current state.
 */
export function clearBoulderState(directory: string): boolean {
  const state = readBoulderState(directory)
  if (state?.plan_name) {
    return clearBoulderStateForPlan(directory, state.plan_name)
  }

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
        return statSync(b).mtimeMs - statSync(a).mtimeMs
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
      isComplete: total === 0 || completed === total,
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

export { findBoulderStateBySession } from "./per-plan-storage"
export {
  readBoulderStateForPlan,
  writeBoulderStateForPlan,
  appendSessionIdForPlan,
  removeSessionIdForPlan,
  clearBoulderStateForPlan,
  listActiveBoulderStates,
} from "./per-plan-storage"
