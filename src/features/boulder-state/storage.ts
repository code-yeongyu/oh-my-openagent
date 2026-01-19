/**
 * Boulder State Storage
 *
 * Handles reading/writing boulder.json for active plan tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, join, basename } from "node:path"
import type { BoulderState, PlanProgress, PhaseStatus } from "./types"
import { BOULDER_DIR, BOULDER_FILE, PROMETHEUS_PLANS_DIR, LEGACY_CHANGES_DIR } from "./constants"

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
    return JSON.parse(content) as BoulderState
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

  if (!state.session_ids.includes(sessionId)) {
    state.session_ids.push(sessionId)
    if (writeBoulderState(directory, state)) {
      return state
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

/**
 * Find Prometheus plan files for this project.
 * Searches two locations (priority order):
 * 1. {project}/.sisyphus/plans/{name}.md (preferred)
 * 2. {project}/changes/{name}/tasks.md (legacy format)
 * 
 * Plans from .sisyphus/plans/ take priority when same name exists in both.
 */
export function findPrometheusPlans(directory: string): string[] {
  const plans: string[] = []
  const seenNames = new Set<string>()

  // 1. Search .sisyphus/plans/*.md (priority)
  const sisyphusPlansDir = join(directory, PROMETHEUS_PLANS_DIR)
  if (existsSync(sisyphusPlansDir)) {
    try {
      const files = readdirSync(sisyphusPlansDir)
      for (const f of files) {
        if (f.endsWith(".md")) {
          const planPath = join(sisyphusPlansDir, f)
          const planName = basename(f, ".md").toLowerCase()
          plans.push(planPath)
          seenNames.add(planName)
        }
      }
    } catch {
      // Ignore errors reading directory
    }
  }

  // 2. Search changes/*/tasks.md (legacy, lower priority)
  const changesDir = join(directory, LEGACY_CHANGES_DIR)
  if (existsSync(changesDir)) {
    try {
      const subdirs = readdirSync(changesDir, { withFileTypes: true })
      for (const dirent of subdirs) {
        if (dirent.isDirectory()) {
          const tasksPath = join(changesDir, dirent.name, "tasks.md")
          if (existsSync(tasksPath)) {
            const planName = dirent.name.toLowerCase()
            // Only add if not already found in .sisyphus/plans/
            if (!seenNames.has(planName)) {
              plans.push(tasksPath)
              seenNames.add(planName)
            }
          }
        }
      }
    } catch {
      // Ignore errors reading directory
    }
  }

  // Sort by modification time, newest first
  return plans.sort((a, b) => {
    try {
      const aStat = require("node:fs").statSync(a)
      const bStat = require("node:fs").statSync(b)
      return bStat.mtimeMs - aStat.mtimeMs
    } catch {
      return 0
    }
  })
}

/**
 * Parse a plan file and count checkbox progress.
 * Detects checkboxes at ALL indentation levels (including sub-task acceptance criteria).
 */
export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: true }
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    
    // Match markdown checkboxes at ANY indentation level:
    // - [ ] unchecked or - [x]/- [X] checked
    // Allows any amount of leading whitespace (spaces/tabs)
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
  sessionId: string
): BoulderState {
  return {
    active_plan: planPath,
    started_at: new Date().toISOString(),
    session_ids: [sessionId],
    plan_name: getPlanName(planPath),
    phase: "idle",
    last_updated: new Date().toISOString(),
  }
}

/**
 * Update phase status in boulder state (Task 9.1)
 */
export function updatePhaseStatus(
  directory: string,
  phase: PhaseStatus,
  currentTask?: string
): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) return null

  state.phase = phase
  state.last_updated = new Date().toISOString()
  
  if (currentTask !== undefined) {
    state.current_task = currentTask
  }
  
  // Reset failure count when moving to a new phase
  if (phase === "executing" || phase === "planning") {
    state.failure_count = 0
    state.last_error = undefined
  }

  if (writeBoulderState(directory, state)) {
    return state
  }
  return null
}

/**
 * Increment failure count for current task (Task 9.2)
 */
export function incrementFailureCount(
  directory: string,
  errorMessage?: string
): { state: BoulderState | null; count: number } {
  const state = readBoulderState(directory)
  if (!state) return { state: null, count: 0 }

  state.failure_count = (state.failure_count || 0) + 1
  state.last_error = errorMessage
  state.last_updated = new Date().toISOString()

  if (writeBoulderState(directory, state)) {
    return { state, count: state.failure_count }
  }
  return { state: null, count: 0 }
}

/**
 * Reset failure count (e.g., after successful task or user intervention)
 */
export function resetFailureCount(directory: string): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) return null

  state.failure_count = 0
  state.last_error = undefined
  state.last_updated = new Date().toISOString()

  if (writeBoulderState(directory, state)) {
    return state
  }
  return null
}

/**
 * Get current phase status
 */
export function getCurrentPhase(directory: string): PhaseStatus {
  const state = readBoulderState(directory)
  return state?.phase || "idle"
}

/**
 * Check if currently in a phase that allows planning agents
 */
export function canCallPlanningAgents(directory: string): boolean {
  const phase = getCurrentPhase(directory)
  return phase === "idle" || phase === "planning" || phase === "reviewing"
}

/**
 * Check if currently in executing phase
 */
export function isExecutingPhase(directory: string): boolean {
  const phase = getCurrentPhase(directory)
  return phase === "executing"
}

/**
 * Mark boulder as complete - clears active_plan and sets phase to completed.
 * This prevents Phase 3 from triggering repeatedly.
 */
export function markBoulderComplete(directory: string): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) return null

  // Store the completed plan info before clearing
  const completedState: BoulderState = {
    ...state,
    active_plan: "", // Clear active plan to stop continuation triggers
    phase: "completed",
    last_updated: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }

  if (writeBoulderState(directory, completedState)) {
    return completedState
  }
  return null
}
