import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"

import { PROMETHEUS_PLANS_DIR } from "../constants"
import type { PlanProgress } from "../types"

const TODO_HEADING_PATTERN = /^##\s+TODOs\b/i
const FINAL_VERIFICATION_HEADING_PATTERN = /^##\s+Final Verification Wave\b/i
const SECOND_LEVEL_HEADING_PATTERN = /^##\s+/
const UNCHECKED_CHECKBOX_PATTERN = /^(\s*)[-*]\s*\[\s*\]\s*(.+)$/
const CHECKED_CHECKBOX_PATTERN = /^(\s*)[-*]\s*\[[xX]\]\s*(.+)$/
const TODO_TASK_PATTERN = /^\d+\.\s+/
const FINAL_WAVE_TASK_PATTERN = /^F\d+\.\s+/i

type ProgressSection = "todo" | "final-wave" | "other"

export function findPrometheusPlans(directory: string): string[] {
  const plansDir = join(directory, PROMETHEUS_PLANS_DIR)
  if (!existsSync(plansDir)) {
    return []
  }

  try {
    return readdirSync(plansDir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => join(plansDir, file))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  } catch {
    return []
  }
}

export function getPlanName(planPath: string): string {
  return basename(planPath, ".md")
}

export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: false }
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    const lines = content.split(/\r?\n/)
    const hasStructuredSections = lines.some(
      (line) => TODO_HEADING_PATTERN.test(line) || FINAL_VERIFICATION_HEADING_PATTERN.test(line),
    )
    if (hasStructuredSections) {
      return getStructuredPlanProgress(lines)
    }

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
    if (!match || match[1].length > 0) {
      continue
    }

    const taskBody = match[2].trim()
    const labelPattern = section === "todo" ? TODO_TASK_PATTERN : FINAL_WAVE_TASK_PATTERN
    if (!labelPattern.test(taskBody)) {
      continue
    }

    total += 1
    if (checkedMatch) {
      completed += 1
    }
  }

  return { total, completed, isComplete: total > 0 && completed === total }
}

function getSimplePlanProgress(content: string): PlanProgress {
  const uncheckedMatches = content.match(/^[-*]\s*\[\s*\]/gm) ?? []
  const checkedMatches = content.match(/^[-*]\s*\[[xX]\]/gm) ?? []
  const total = uncheckedMatches.length + checkedMatches.length
  const completed = checkedMatches.length
  return { total, completed, isComplete: total > 0 && completed === total }
}
