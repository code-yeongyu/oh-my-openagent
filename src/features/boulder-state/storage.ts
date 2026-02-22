/**
 * Boulder State Storage
 *
 * Handles reading/writing boulder.json for active plan tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, join, basename } from "node:path"
import type { BoulderState, PlanProgress } from "./types"
import { BOULDER_DIR, BOULDER_FILE, BOULDERS_DIR, PROMETHEUS_PLANS_DIR } from "./constants"

export function getBoulderFilePath(directory: string, planName?: string): string {
  if (planName) {
    return join(directory, BOULDER_DIR, BOULDERS_DIR, `${planName}.json`)
  }
  return join(directory, BOULDER_DIR, BOULDER_FILE)
}

export function readBoulderState(directory: string, planName?: string): BoulderState | null {
  const filePath = getBoulderFilePath(directory, planName)

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

export function writeBoulderState(directory: string, state: BoulderState, planName?: string): boolean {
  const filePath = getBoulderFilePath(directory, planName)

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

export function appendSessionId(directory: string, sessionId: string, planName?: string): BoulderState | null {
  // If planName given but per-plan file doesn't exist, fall back to legacy path
  const resolvedPlanName = planName && existsSync(getBoulderFilePath(directory, planName)) ? planName : undefined
  const state = readBoulderState(directory, resolvedPlanName)
  if (!state) return null
  if (!state.session_ids?.includes(sessionId)) {
    if (!Array.isArray(state.session_ids)) {
      state.session_ids = []
    }
    state.session_ids.push(sessionId)
    if (writeBoulderState(directory, state, resolvedPlanName)) {
      return state
    }
  }

  return state
}

export function clearBoulderState(directory: string, planName?: string): boolean {
  const filePath = getBoulderFilePath(directory, planName)

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

export function findBoulderForSession(directory: string, sessionID: string): BoulderState | null {
  const bouldersDirectory = join(directory, BOULDER_DIR, BOULDERS_DIR)

  // Check per-plan boulders first
  if (existsSync(bouldersDirectory)) {
    try {
      const files = readdirSync(bouldersDirectory)
      for (const file of files) {
        if (!file.endsWith(".json")) continue
        try {
          const content = readFileSync(join(bouldersDirectory, file), "utf-8")
          const parsed = JSON.parse(content)
          if (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed) &&
            Array.isArray(parsed.session_ids) &&
            parsed.session_ids.includes(sessionID)
          ) {
            return parsed as BoulderState
          }
        } catch {
          continue
        }
      }
    } catch {
      // Fall through to legacy check
    }
  }

  // Fall back to legacy boulder.json
  const legacyState = readBoulderState(directory)
  if (legacyState?.session_ids?.includes(sessionID)) {
    return legacyState
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
    const uncheckedMatches = content.match(/^[-*]\s*\[\s*\]/gm) || []
    const checkedMatches = content.match(/^[-*]\s*\[[xX]\]/gm) || []

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
  agent?: string
): BoulderState {
  return {
    active_plan: planPath,
    started_at: new Date().toISOString(),
    session_ids: [sessionId],
    plan_name: getPlanName(planPath),
    ...(agent !== undefined ? { agent } : {}),
  }
}
