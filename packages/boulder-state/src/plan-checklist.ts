import { existsSync, readFileSync } from "node:fs"

import type { PlanChecklist } from "./types"

const CHECKBOX_PATTERN = /^- \[[ xX]\] /
const UNCHECKED_PATTERN = /^- \[ \] /
const TODO_HEADING = "TODOs"
const FINAL_VERIFICATION_HEADING = "Final Verification Wave"

export function getPlanChecklist(planPath: string): PlanChecklist {
  if (!existsSync(planPath)) {
    return emptyChecklist()
  }

  try {
    return parsePlanChecklist(readFileSync(planPath, "utf-8"))
  } catch (error) {
    if (error instanceof Error) {
      return emptyChecklist()
    }
    throw error
  }
}

export function parsePlanChecklist(markdown: string): PlanChecklist {
  const lines = markdown.split(/\r?\n/)
  const hasCountedSections = lines.some(hasCountedSectionHeading)
  let remaining = 0
  let total = 0
  let nextTaskLabel: string | null = null
  let isCountedSection = !hasCountedSections

  for (const line of lines) {
    const heading = parseLevelTwoHeading(line)
    if (heading !== null) {
      isCountedSection = isCountedHeading(heading)
    }
    if (!isCountedSection || !CHECKBOX_PATTERN.test(line)) {
      continue
    }

    total += 1
    if (!UNCHECKED_PATTERN.test(line)) {
      continue
    }

    remaining += 1
    if (nextTaskLabel === null) {
      nextTaskLabel = line.slice("- [ ] ".length)
    }
  }

  return {
    completed: total - remaining,
    remaining,
    total,
    nextTaskLabel,
  }
}

function hasCountedSectionHeading(line: string): boolean {
  const heading = parseLevelTwoHeading(line)
  return heading !== null && isCountedHeading(heading)
}

function parseLevelTwoHeading(line: string): string | null {
  if (!line.startsWith("## ")) {
    return null
  }
  return line.slice("## ".length).trim()
}

function isCountedHeading(heading: string): boolean {
  return heading === TODO_HEADING || heading === FINAL_VERIFICATION_HEADING
}

function emptyChecklist(): PlanChecklist {
  return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null }
}
