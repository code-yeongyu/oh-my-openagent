import { existsSync, readFileSync } from "node:fs"

import type { PlanChecklist } from "./types"

const SIMPLE_CHECKBOX_PATTERN = /^- \[[ xX]\] /
const SIMPLE_UNCHECKED_PATTERN = /^- \[ \] /
const TODO_HEADING_PATTERN = /^##\s+TODOs\b/i
const FINAL_VERIFICATION_HEADING_PATTERN = /^##\s+Final Verification Wave\b/i
const SECOND_LEVEL_HEADING_PATTERN = /^##\s+/
const UNCHECKED_CHECKBOX_PATTERN = /^(\s*)[-*]\s*\[\s*\]\s*(.+)$/
const CHECKED_CHECKBOX_PATTERN = /^(\s*)[-*]\s*\[[xX]\]\s*(.+)$/
const TODO_TASK_PATTERN = /^\d+\.\s+/
const FINAL_WAVE_TASK_PATTERN = /^F\d+\.\s+/i

type ChecklistSection = "todo" | "final-wave" | "other"

type ParsedCheckbox = {
  readonly checked: boolean
  readonly label: string
}

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
  if (!lines.some(hasStructuredSectionHeading)) {
    return parseSimpleChecklist(lines)
  }

  let remaining = 0
  let total = 0
  let nextTaskLabel: string | null = null
  let section: ChecklistSection = "other"

  for (const line of lines) {
    const headingSection = parseStructuredSectionHeading(line)
    if (headingSection !== null) {
      section = headingSection
      continue
    }
    if (section === "other") {
      continue
    }

    const checkbox = parseStructuredTopLevelCheckbox(line, section)
    if (checkbox === null) {
      continue
    }

    total += 1
    if (checkbox.checked) {
      continue
    }

    remaining += 1
    if (nextTaskLabel === null) {
      nextTaskLabel = checkbox.label
    }
  }

  return {
    completed: total - remaining,
    remaining,
    total,
    nextTaskLabel,
  }
}

function parseSimpleChecklist(lines: readonly string[]): PlanChecklist {
  let remaining = 0
  let total = 0
  let nextTaskLabel: string | null = null

  for (const line of lines) {
    if (!SIMPLE_CHECKBOX_PATTERN.test(line)) {
      continue
    }

    total += 1
    if (!SIMPLE_UNCHECKED_PATTERN.test(line)) {
      continue
    }

    remaining += 1
    if (nextTaskLabel === null) {
      nextTaskLabel = line.slice("- [ ] ".length)
    }
  }

  return { completed: total - remaining, remaining, total, nextTaskLabel }
}

function hasStructuredSectionHeading(line: string): boolean {
  const section = parseStructuredSectionHeading(line)
  return section === "todo" || section === "final-wave"
}

function parseStructuredSectionHeading(line: string): ChecklistSection | null {
  if (!SECOND_LEVEL_HEADING_PATTERN.test(line)) {
    return null
  }

  if (TODO_HEADING_PATTERN.test(line)) {
    return "todo"
  }
  if (FINAL_VERIFICATION_HEADING_PATTERN.test(line)) {
    return "final-wave"
  }
  return "other"
}

function parseStructuredTopLevelCheckbox(
  line: string,
  section: "todo" | "final-wave",
): ParsedCheckbox | null {
  const checkedMatch = line.match(CHECKED_CHECKBOX_PATTERN)
  const match = checkedMatch ?? line.match(UNCHECKED_CHECKBOX_PATTERN)
  if (match === null) {
    return null
  }

  const indentation = match[1]
  const taskBody = match[2]?.trim()
  if (indentation !== "" || taskBody === undefined) {
    return null
  }

  const labelPattern = section === "todo" ? TODO_TASK_PATTERN : FINAL_WAVE_TASK_PATTERN
  if (!labelPattern.test(taskBody)) {
    return null
  }

  return { checked: checkedMatch !== null, label: taskBody }
}

function emptyChecklist(): PlanChecklist {
  return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null }
}
