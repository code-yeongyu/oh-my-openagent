/**
 * Boulder State Storage
 *
 * Handles reading/writing boulder.json for active plan tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, cpSync, rmSync } from "node:fs"
import { dirname, join, basename } from "node:path"
import type { BoulderState, PlanProgress, ArchiveResult } from "./types"
import { BOULDER_DIR, BOULDER_FILE, PROMETHEUS_PLANS_DIR, COMPLETED_PLANS_DIR, NOTEPAD_BASE_PATH, COMPLETED_NOTEPAD_DIR } from "./constants"

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

/**
 * Find a unique target path by appending -2, -3, etc. if needed.
 */
function findUniqueTargetPath(basePath: string): string {
  if (!existsSync(basePath)) {
    return basePath
  }

  let counter = 2
  while (true) {
    const newPath = basePath.replace(/\.md$/, `-${counter}.md`)
    if (!existsSync(newPath)) {
      return newPath
    }
    counter++
  }
}

/**
 * Archive a completed plan by moving it to the completed directory.
 * Also moves the corresponding notepad file if it exists.
 * Handles name conflicts by auto-renaming.
 */
export function archivePlan(directory: string, planName: string): ArchiveResult {
  const sourcePlanPath = join(directory, PROMETHEUS_PLANS_DIR, `${planName}.md`)
  const sourceNotepadPath = join(directory, NOTEPAD_BASE_PATH, `${planName}.md`)

  if (!existsSync(sourcePlanPath)) {
    return { success: false, error: `Source plan not found: ${planName}` }
  }

  const completedPlansDir = join(directory, COMPLETED_PLANS_DIR)
  const completedNotepadDir = join(directory, COMPLETED_NOTEPAD_DIR)

  try {
    if (!existsSync(completedPlansDir)) {
      mkdirSync(completedPlansDir, { recursive: true })
    }
  } catch (err) {
    return { success: false, error: `Failed to create completed plans directory: ${err}` }
  }

  const targetPlanPath = findUniqueTargetPath(join(completedPlansDir, `${planName}.md`))
  const hasNotepad = existsSync(sourceNotepadPath)
  let targetNotepadPath: string | undefined

  if (hasNotepad) {
    try {
      if (!existsSync(completedNotepadDir)) {
        mkdirSync(completedNotepadDir, { recursive: true })
      }
    } catch (err) {
      return { success: false, error: `Failed to create completed notepad directory: ${err}` }
    }
    targetNotepadPath = findUniqueTargetPath(join(completedNotepadDir, `${planName}.md`))
  }

  let planMoved = false
  let notepadMoved = false

  try {
    try {
      renameSync(sourcePlanPath, targetPlanPath)
      planMoved = true
    } catch {
      try {
        cpSync(sourcePlanPath, targetPlanPath)
        rmSync(sourcePlanPath)
        planMoved = true
      } catch (fallbackErr) {
        return { success: false, error: `Failed to move plan: ${fallbackErr}` }
      }
    }

    if (hasNotepad && targetNotepadPath) {
      try {
        renameSync(sourceNotepadPath, targetNotepadPath)
        notepadMoved = true
      } catch {
        try {
          cpSync(sourceNotepadPath, targetNotepadPath)
          rmSync(sourceNotepadPath)
          notepadMoved = true
        } catch {
          if (planMoved) {
            try { renameSync(targetPlanPath, sourcePlanPath) } catch {}
          }
          return { success: false, error: "Failed to move notepad, rolled back plan" }
        }
      }
    }

    return {
      success: true,
      archivedPlanPath: targetPlanPath,
      archivedNotepadPath: notepadMoved ? targetNotepadPath : undefined,
    }
  } catch (err) {
    if (planMoved) { try { renameSync(targetPlanPath, sourcePlanPath) } catch {} }
    if (notepadMoved && targetNotepadPath) { try { renameSync(targetNotepadPath, sourceNotepadPath) } catch {} }
    return { success: false, error: `Archive failed: ${err}` }
  }
}

/**
 * Find all completed plan files in the completed directory.
 */
export function findCompletedPlans(directory: string): string[] {
  const completedDir = join(directory, COMPLETED_PLANS_DIR)

  if (!existsSync(completedDir)) {
    return []
  }

  try {
    const files = readdirSync(completedDir)
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(completedDir, f))
      .sort((a, b) => {
        const aStat = require("node:fs").statSync(a)
        const bStat = require("node:fs").statSync(b)
        return bStat.mtimeMs - aStat.mtimeMs
      })
  } catch {
    return []
  }
}
