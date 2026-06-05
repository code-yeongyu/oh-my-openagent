import { existsSync, readFileSync } from "node:fs"

const TODO_HEADING_PATTERN = /^##\s+TODOs\b/i
const FINAL_VERIFICATION_HEADING_PATTERN = /^##\s+Final Verification Wave\b/i
const SECOND_LEVEL_HEADING_PATTERN = /^##\s+/
const CHECKED_CHECKBOX_PATTERN = /^(\s*)[-*]\s*\[[xX]\]\s*(.+)$/
const TODO_TASK_PATTERN = /^(\d+)\.\s+(.+)$/
const FINAL_WAVE_TASK_PATTERN = /^(F\d+)\.\s+(.+)$/i

export function isTrackedTaskChecked(planPath: string, taskKey: string): boolean {
  if (!existsSync(planPath)) {
    return false
  }

  const [section, label] = taskKey.split(":")
  if (!section || !label) {
    return false
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const matcher = section === "todo"
    ? new RegExp(`^\\s*[-*]\\s*\\[[xX]\\]\\s*${escapedLabel}\\.\\s+`, "m")
    : section === "final-wave"
      ? new RegExp(`^\\s*[-*]\\s*\\[[xX]\\]\\s*${escapedLabel.toUpperCase()}\\.\\s+`, "m")
      : null
  if (!matcher) {
    return false
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    return matcher.test(content)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return false
  }
}

export function parseCheckedTopLevelTaskKeys(planContent: string): Set<string> {
  const checkedKeys = new Set<string>()
  const lines = planContent.split(/\r?\n/)
  let section: "todo" | "final-wave" | "other" = "other"

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
    if (!checkedMatch || checkedMatch[1].length > 0) {
      continue
    }

    const taskBody = checkedMatch[2].trim()
    if (section === "todo") {
      const taskMatch = taskBody.match(TODO_TASK_PATTERN)
      if (taskMatch?.[1]) {
        checkedKeys.add(`todo:${taskMatch[1]}`)
      }
      continue
    }

    const taskMatch = taskBody.match(FINAL_WAVE_TASK_PATTERN)
    if (taskMatch?.[1]) {
      checkedKeys.add(`final-wave:${taskMatch[1].toLowerCase()}`)
    }
  }

  return checkedKeys
}

export function readCheckedTaskKeysFromPlan(planPath: string): Set<string> {
  if (!existsSync(planPath)) {
    return new Set<string>()
  }

  try {
    return parseCheckedTopLevelTaskKeys(readFileSync(planPath, "utf-8"))
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return new Set<string>()
  }
}
