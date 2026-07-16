import { existsSync, readFileSync } from "node:fs"

import type { PlanChecklist, TopLevelTaskRef } from "./types"

const SIMPLE_CHECKBOX_PATTERN = /^[-*][ \t]*\[[ \t]*([xX]?)[ \t]*\][ \t]+(.+)$/
const TODO_HEADING_PATTERN = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i
const FINAL_VERIFICATION_HEADING_PATTERN =
  /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i
const MARKDOWN_HEADING_PATTERN = /^#{1,6}(?:[ \t]+|$)/
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/
const TODO_CHECKBOX_PATTERN = /^- \[([ xX])\] ([1-9]\d*\. .+)$/
const FINAL_WAVE_CHECKBOX_PATTERN = /^- \[([ xX])\] (F[1-9]\d*\. .+)$/i

type ChecklistSection = "todo" | "final-wave" | "other"

type ParsedCheckbox = {
  readonly checked: boolean
  readonly label: string
}

type ParsedStructuredCheckbox = ParsedCheckbox & {
  readonly task: TopLevelTaskRef
}

type MarkdownFence = {
  readonly marker: "`" | "~"
  readonly length: number
}

type ParsedStructuredPlan = {
  readonly checklist: PlanChecklist
  readonly nextTask: TopLevelTaskRef | null
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

  return parseStructuredPlan(lines).checklist
}

export function parseCurrentTopLevelTask(markdown: string): TopLevelTaskRef | null {
  const lines = markdown.split(/\r?\n/)
  if (!hasStructuredSection(lines)) {
    return null
  }

  return parseStructuredPlan(lines).nextTask
}

function parseStructuredPlan(lines: readonly string[]): ParsedStructuredPlan {
  let remaining = 0
  let total = 0
  let nextTaskLabel: string | null = null
  let nextTask: TopLevelTaskRef | null = null
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

    if (MARKDOWN_HEADING_PATTERN.test(line)) {
      section = parseStructuredSectionHeading(line)
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
      nextTask = checkbox.task
    }
  }

  return {
    checklist: {
      completed: total - remaining,
      remaining,
      total,
      nextTaskLabel,
    },
    nextTask,
  }
}

function parseSimpleChecklist(lines: readonly string[]): PlanChecklist {
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
    if (checkbox.checked) {
      continue
    }

    remaining += 1
    if (nextTaskLabel === null) {
      nextTaskLabel = checkbox.label
    }
  }

  return { completed: total - remaining, remaining, total, nextTaskLabel }
}

function parseSimpleTopLevelCheckbox(line: string): ParsedCheckbox | null {
  const match = line.match(SIMPLE_CHECKBOX_PATTERN)
  const marker = match?.[1]
  const label = match?.[2]
  if (marker === undefined || label === undefined) {
    return null
  }
  return { checked: marker.toLowerCase() === "x", label }
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
  const pattern = section === "todo" ? TODO_CHECKBOX_PATTERN : FINAL_WAVE_CHECKBOX_PATTERN
  const match = line.match(pattern)
  const marker = match?.[1]
  const label = match?.[2]
  if (marker === undefined || label === undefined) {
    return null
  }
  const task = buildTaskRef(section, label)
  if (task === null) {
    return null
  }
  return { checked: marker.toLowerCase() === "x", label, task }
}

function buildTaskRef(section: "todo" | "final-wave", label: string): TopLevelTaskRef | null {
  const pattern = section === "todo" ? /^([1-9]\d*)\. (.+)$/ : /^(F[1-9]\d*)\. (.+)$/i
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

function parseOpeningFence(line: string): MarkdownFence | null {
  const match = line.match(FENCE_PATTERN)
  const run = match?.[1]
  const info = match?.[2]
  const marker = run?.charAt(0)
  if (
    run === undefined ||
    info === undefined ||
    (marker !== "`" && marker !== "~") ||
    (marker === "`" && info.includes("`"))
  ) {
    return null
  }
  return { marker, length: run.length }
}

function isClosingFence(line: string, fence: MarkdownFence): boolean {
  const run = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1]
  return run?.charAt(0) === fence.marker && run.length >= fence.length
}

function emptyChecklist(): PlanChecklist {
  return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null }
}
