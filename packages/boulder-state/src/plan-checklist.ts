import { existsSync, readFileSync } from "node:fs"

import { isClosingFence, parseOpeningFence, type MarkdownFence } from "./markdown-fence"
import type { PlanChecklist, TopLevelTaskRef } from "./types"

const SIMPLE_CHECKBOX_PATTERN = /^[-*][ \t]*\[[ \t]*([xX~]?)[ \t]*\][ \t]+(.+)$/
const TODO_HEADING_PATTERN = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i
const FINAL_VERIFICATION_HEADING_PATTERN =
  /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i
const SECTION_BOUNDARY_HEADING_PATTERN = /^#{1,2}(?:[ \t]+|$)/
const STRUCTURED_CHECKBOX_PATTERN = /^- \[([ xX~])\] (.+)$/
const TODO_TASK_LABEL_PATTERN =
  /^([1-9]\d*|T[1-9]\d*(?:\.[1-9]\d*[a-z]?)?)(?:\.[ \t]+|[ \t]+(?:[-\u2014][ \t]+)?)(.+)$/i
const FINAL_WAVE_TASK_LABEL_PATTERN =
  /^([FH][1-9]\d*(?:\.[1-9]\d*[a-z]?)?)(?:\.[ \t]+|[ \t]+(?:[-\u2014][ \t]+)?)(.+)$/i

type ChecklistSection = "todo" | "final-wave" | "other"

// `[~]` marks a task the agent could not finish (blocked on the user or external input): it counts
// toward the total but is neither completed nor actionable, so it never keeps a continuation alive.
type CheckboxStatus = "open" | "done" | "in-progress"

type ParsedCheckbox = {
  readonly status: CheckboxStatus
  readonly label: string
}

type ParsedStructuredCheckbox = ParsedCheckbox & {
  readonly task: TopLevelTaskRef
}

type ParsedStructuredPlan = {
  readonly checklist: PlanChecklist
  readonly nextTask: TopLevelTaskRef | null
  readonly hasUntrackedTopLevelCheckbox: boolean
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
  if (!hasStructuredSection(lines)) {
    return parseSimpleChecklist(lines)
  }

  const structuredPlan = parseStructuredPlan(lines)
  if (structuredPlan.checklist.total === 0 && structuredPlan.hasUntrackedTopLevelCheckbox) {
    return parseSimpleChecklist(lines)
  }

  return structuredPlan.checklist
}

/** Whether `line` is a top-level task row the structured parser counts inside `section`. */
export function isStructuredTaskRow(line: string, section: "todo" | "final-wave"): boolean {
  return parseStructuredTopLevelCheckbox(line, section) !== null
}

export function parseCurrentTopLevelTask(markdown: string): TopLevelTaskRef | null {
  const lines = markdown.split(/\r?\n/)
  if (!hasStructuredSection(lines)) {
    return null
  }

  return parseStructuredPlan(lines).nextTask
}

function parseStructuredPlan(lines: readonly string[]): ParsedStructuredPlan {
  let completed = 0
  let remaining = 0
  let total = 0
  let nextTaskLabel: string | null = null
  let nextTask: TopLevelTaskRef | null = null
  let hasUntrackedTopLevelCheckbox = false
  let section: ChecklistSection = "other"
  let fence: MarkdownFence | null = null

  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null
      }
      continue
    }

    const openingFence = parseOpeningFence(line)
    if (openingFence !== null) {
      fence = openingFence
      continue
    }

    if (SECTION_BOUNDARY_HEADING_PATTERN.test(line)) {
      section = parseStructuredSectionHeading(line)
      continue
    }
    if (section === "other") {
      if (parseSimpleTopLevelCheckbox(line) !== null) {
        hasUntrackedTopLevelCheckbox = true
      }
      continue
    }

    const checkbox = parseStructuredTopLevelCheckbox(line, section)
    if (checkbox === null) {
      continue
    }

    total += 1
    if (checkbox.status === "done") {
      completed += 1
      continue
    }
    if (checkbox.status === "in-progress") {
      continue
    }

    remaining += 1
    if (nextTaskLabel === null) {
      nextTaskLabel = checkbox.label
      nextTask = checkbox.task
    }
  }

  return {
    checklist: {
      completed,
      remaining,
      total,
      nextTaskLabel,
    },
    nextTask,
    hasUntrackedTopLevelCheckbox,
  }
}

function parseSimpleChecklist(lines: readonly string[]): PlanChecklist {
  let completed = 0
  let remaining = 0
  let total = 0
  let nextTaskLabel: string | null = null
  let fence: MarkdownFence | null = null

  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null
      }
      continue
    }

    const openingFence = parseOpeningFence(line)
    if (openingFence !== null) {
      fence = openingFence
      continue
    }

    const checkbox = parseSimpleTopLevelCheckbox(line)
    if (checkbox === null) {
      continue
    }

    total += 1
    if (checkbox.status === "done") {
      completed += 1
      continue
    }
    if (checkbox.status === "in-progress") {
      continue
    }

    remaining += 1
    if (nextTaskLabel === null) {
      nextTaskLabel = checkbox.label
    }
  }

  return { completed, remaining, total, nextTaskLabel }
}

function parseSimpleTopLevelCheckbox(line: string): ParsedCheckbox | null {
  const match = line.match(SIMPLE_CHECKBOX_PATTERN)
  const marker = match?.[1]
  const label = match?.[2]
  if (marker === undefined || label === undefined) {
    return null
  }
  return { status: parseCheckboxStatus(marker), label }
}

function parseCheckboxStatus(marker: string): CheckboxStatus {
  if (marker.toLowerCase() === "x") {
    return "done"
  }
  return marker === "~" ? "in-progress" : "open"
}

function hasStructuredSection(lines: readonly string[]): boolean {
  let fence: MarkdownFence | null = null
  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null
      }
      continue
    }

    const openingFence = parseOpeningFence(line)
    if (openingFence !== null) {
      fence = openingFence
      continue
    }
    if (parseStructuredSectionHeading(line) !== "other") {
      return true
    }
  }
  return false
}

function parseStructuredSectionHeading(line: string): ChecklistSection {
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
): ParsedStructuredCheckbox | null {
  const match = line.match(STRUCTURED_CHECKBOX_PATTERN)
  const marker = match?.[1]
  const label = match?.[2]
  if (marker === undefined || label === undefined) {
    return null
  }
  const task = buildTaskRef(section, label)
  if (task === null) {
    return null
  }
  return { status: parseCheckboxStatus(marker), label, task }
}

function buildTaskRef(section: "todo" | "final-wave", label: string): TopLevelTaskRef | null {
  const pattern = section === "todo" ? TODO_TASK_LABEL_PATTERN : FINAL_WAVE_TASK_LABEL_PATTERN
  const match = label.match(pattern)
  const rawLabel = match?.[1]
  const title = match?.[2]
  if (rawLabel === undefined || title === undefined) {
    return null
  }
  return {
    key: `${section}:${rawLabel.toLowerCase()}`,
    section,
    label: rawLabel,
    title,
  }
}

function emptyChecklist(): PlanChecklist {
  return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null }
}
