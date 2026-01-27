/**
 * Boulder State Storage
 *
 * Handles reading/writing boulder.json for active plan tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, join, basename } from "node:path"
import type { BoulderState, PlanProgress, PhaseStatus, TaskPhaseInfo, TaskPhaseStatus } from "./types"
import { BOULDER_DIR, BOULDER_FILE, CHANGES_DIR } from "./constants"

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
 * Searches in changes/ directory:
 * - {project}/changes/{name}/tasks.md (standard format)
 */
export function findPrometheusPlans(directory: string): string[] {
  const plans: string[] = []

  // Search changes/*/tasks.md
  const changesDir = join(directory, CHANGES_DIR)
  if (existsSync(changesDir)) {
    try {
      const subdirs = readdirSync(changesDir, { withFileTypes: true })
      for (const dirent of subdirs) {
        if (dirent.isDirectory()) {
          const tasksPath = join(changesDir, dirent.name, "tasks.md")
          if (existsSync(tasksPath)) {
            plans.push(tasksPath)
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
 * Parse phase status from text (backtick or Status line)
 * Priority: backtick > Status line > default pending
 */
function parsePhaseStatus(headerLine: string, contentLines: string[]): TaskPhaseStatus {
  // 1. Check backtick syntax: `complete`, `in_progress`, `pending`
  const backtickMatch = headerLine.match(/`(complete|in_progress|pending)`/i)
  if (backtickMatch) {
    return backtickMatch[1].toLowerCase().replace(" ", "_") as TaskPhaseStatus
  }
  
  // 2. Check Status line: - **Status:** complete
  for (const line of contentLines) {
    const statusMatch = line.match(/\*\*Status:\*\*\s*(complete|in_progress|pending)/i)
    if (statusMatch) {
      return statusMatch[1].toLowerCase().replace(" ", "_") as TaskPhaseStatus
    }
  }
  
  // 3. Default to pending
  return "pending"
}

/**
 * Extract phase name from header line (remove backtick status)
 */
function extractPhaseName(headerLine: string): string {
  return headerLine
    .replace(/^#{2,3}\s*/, "")
    .replace(/\s*`[^`]+`\s*$/, "")
    .trim()
}

/**
 * Parse a plan file and count checkbox progress.
 * Detects checkboxes at ALL indentation levels (including sub-task acceptance criteria).
 * Also parses phase information from Manus-style syntax.
 */
export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: true }
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    const lines = content.split(/\r?\n/)
    
    // Match markdown checkboxes at ANY indentation level:
    // - [ ] unchecked or - [x]/- [X] checked
    // Allows any amount of leading whitespace (spaces/tabs)
    const uncheckedMatches = content.match(/^\s*[-*]\s*\[\s*\]/gm) || []
    const checkedMatches = content.match(/^\s*[-*]\s*\[[xX]\]/gm) || []

    const total = uncheckedMatches.length + checkedMatches.length
    const completed = checkedMatches.length

    // Parse phases
    const phases: TaskPhaseInfo[] = []
    const phaseHeaderRegex = /^#{2,3}\s+Phase\s+\d+:/i
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (phaseHeaderRegex.test(line)) {
        // Find phase end (next phase header, ---, or EOF)
        let endLine = lines.length
        for (let j = i + 1; j < lines.length; j++) {
          if (phaseHeaderRegex.test(lines[j]) || lines[j].trim() === "---") {
            endLine = j
            break
          }
        }
        
        // Get content lines between header and end
        const contentLines = lines.slice(i + 1, endLine)
        
        phases.push({
          name: extractPhaseName(line),
          status: parsePhaseStatus(line, contentLines),
          line: i + 1, // 1-indexed line number
          endLine: endLine,
        })
      }
    }

    // Calculate isComplete: checkboxes AND phases
    const checkboxesComplete = total === 0 || completed === total
    const phasesComplete = phases.length === 0 || phases.every(p => p.status === "complete")

    return {
      total,
      completed,
      isComplete: checkboxesComplete && phasesComplete,
      phases: phases.length > 0 ? phases : undefined,
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
