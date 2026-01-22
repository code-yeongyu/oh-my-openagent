/**
 * Plan Progress Reader
 *
 * Read-only module for parsing tasks.md progress.
 * This is the "File is Source of Truth" implementation.
 */

import { existsSync, readFileSync } from "node:fs"
import { readBoulderState, getPlanProgress } from "../boulder-state/storage"
import type { TaskPhaseInfo } from "../boulder-state/types"

/** Checkbox status in tasks.md */
export type CheckboxStatus = "pending" | "in_progress" | "completed" | "cancelled"

/** Checkbox priority level */
export type CheckboxPriority = "high" | "medium" | "low"

/** Individual checkbox info parsed from tasks.md */
export interface CheckboxInfo {
  /** Line number in the file (1-indexed) */
  line: number
  /** The checkbox content text */
  content: string
  /** Status based on checkbox marker */
  status: CheckboxStatus
  /** Priority based on context */
  priority: CheckboxPriority
}

/** Extended plan progress with checkbox details */
export interface PlanProgressDetail {
  /** Total number of checkboxes */
  total: number
  /** Number of completed checkboxes */
  completed: number
  /** Whether all tasks are done (checkboxes AND phases) */
  isComplete: boolean
  /** Phase information if present */
  phases?: TaskPhaseInfo[]
  /** Individual checkbox details */
  checkboxes: CheckboxInfo[]
  /** Path to the plan file */
  planPath: string
}

/**
 * Parse checkbox status from marker
 * - [ ] → pending
 * - [~] → in_progress
 * - [x] or [X] → completed
 * - [-] → cancelled
 */
function parseCheckboxStatus(marker: string): CheckboxStatus {
  const inner = marker.match(/\[(.)\]/)?.[1]?.toLowerCase()
  switch (inner) {
    case "x":
      return "completed"
    case "~":
      return "in_progress"
    case "-":
      return "cancelled"
    default:
      return "pending"
  }
}

/**
 * Determine checkbox priority based on context
 * - Under "**Acceptance Criteria:**" → low
 * - Indented (sub-task) → medium
 * - Top-level in phase → high
 */
function determineCheckboxPriority(
  line: string,
  lineIndex: number,
  lines: string[]
): CheckboxPriority {
  // Check if indented (sub-task)
  const isIndented = /^(\s{2,}|\t+)[-*]\s*\[/.test(line)
  
  // Check if under Acceptance Criteria by looking backwards
  for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 10; i--) {
    const prevLine = lines[i]
    // Stop at headers
    if (/^#{1,4}\s/.test(prevLine)) break
    // Check for Acceptance Criteria marker
    if (/\*\*Acceptance Criteria:?\*\*/i.test(prevLine)) {
      return "low"
    }
  }
  
  // Indented but not under Acceptance Criteria → medium
  if (isIndented) {
    return "medium"
  }
  
  // Top-level checkbox → high
  return "high"
}

/**
 * Parse all checkboxes from content
 */
function parseCheckboxes(content: string): CheckboxInfo[] {
  const lines = content.split(/\r?\n/)
  const checkboxes: CheckboxInfo[] = []
  
  // Match: - [ ] or - [x] or - [~] or - [-] or * [ ] etc.
  const checkboxRegex = /^(\s*)[-*]\s*(\[.\])\s*(.*)$/
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(checkboxRegex)
    if (match) {
      const marker = match[2]
      const content = match[3].trim()
      
      checkboxes.push({
        line: i + 1, // 1-indexed
        content,
        status: parseCheckboxStatus(marker),
        priority: determineCheckboxPriority(line, i, lines),
      })
    }
  }
  
  return checkboxes
}

/**
 * Read plan progress from tasks.md (read-only)
 * 
 * This function:
 * 1. Reads boulder.json to get active_plan path
 * 2. Parses tasks.md checkboxes and phases
 * 3. Returns structured progress data
 * 
 * @param directory - Project root directory
 * @returns PlanProgressDetail or null if no active plan
 */
export function readPlanProgress(directory: string): PlanProgressDetail | null {
  // 1. Read boulder.json to get active plan
  const boulderState = readBoulderState(directory)
  if (!boulderState || !boulderState.active_plan) {
    return null
  }
  
  const planPath = boulderState.active_plan
  
  // 2. Check if plan file exists
  if (!existsSync(planPath)) {
    return null
  }
  
  // 3. Get base progress (checkboxes + phases)
  const baseProgress = getPlanProgress(planPath)
  
  // 4. Parse detailed checkbox info
  const content = readFileSync(planPath, "utf-8")
  const checkboxes = parseCheckboxes(content)
  
  return {
    total: baseProgress.total,
    completed: baseProgress.completed,
    isComplete: baseProgress.isComplete,
    phases: baseProgress.phases,
    checkboxes,
    planPath,
  }
}
