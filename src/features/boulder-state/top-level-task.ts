import { existsSync, readFileSync } from "node:fs"

import type { TopLevelTaskRef } from "./types"

const TODO_HEADING_PATTERN = /^##\s+TODOs\b/i
const FINAL_VERIFICATION_HEADING_PATTERN = /^##\s+Final Verification Wave\b/i
const SECOND_LEVEL_HEADING_PATTERN = /^##\s+/
const UNCHECKED_CHECKBOX_PATTERN = /^(\s*)[-*]\s*\[\s*\]\s*(.+)$/
const TODO_TASK_PATTERN = /^(\d+)\.\s+(.+)$/
const FINAL_WAVE_TASK_PATTERN = /^(F\d+)\.\s+(.+)$/i

type PlanSection = "todo" | "final-wave" | "other"

function buildTaskRef(
  section: "todo" | "final-wave",
  taskLabel: string,
): TopLevelTaskRef | null {
  const pattern = section === "todo" ? TODO_TASK_PATTERN : FINAL_WAVE_TASK_PATTERN
  const match = taskLabel.match(pattern)
  if (!match) {
    return null
  }

  const rawLabel = match[1]
  const title = match[2].trim()

  return {
    key: `${section}:${rawLabel.toLowerCase()}`,
    section,
    label: rawLabel,
    title,
  }
}

export function readCurrentTopLevelTask(planPath: string): TopLevelTaskRef | null {
  if (!existsSync(planPath)) {
    return null
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    const lines = content.split(/\r?\n/)
    let section: PlanSection = "other"

    for (const line of lines) {
      if (SECOND_LEVEL_HEADING_PATTERN.test(line)) {
        section = TODO_HEADING_PATTERN.test(line)
          ? "todo"
          : FINAL_VERIFICATION_HEADING_PATTERN.test(line)
            ? "final-wave"
            : "other"
      }

      const uncheckedTaskMatch = line.match(UNCHECKED_CHECKBOX_PATTERN)
      if (!uncheckedTaskMatch) {
        continue
      }

      if (uncheckedTaskMatch[1].length > 0) {
        continue
      }

      if (section !== "todo" && section !== "final-wave") {
        continue
      }

      const taskRef = buildTaskRef(section, uncheckedTaskMatch[2].trim())
      if (taskRef) {
        return taskRef
      }
    }

    return null
  } catch {
    return null
  }
}
