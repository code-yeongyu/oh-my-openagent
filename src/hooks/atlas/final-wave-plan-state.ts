import { existsSync, readFileSync } from "node:fs"

const TODO_HEADING_PATTERN = /^##\s+TODOs\b/i
const FINAL_VERIFICATION_HEADING_PATTERN = /^##\s+Final Verification Wave\b/i
const SECOND_LEVEL_HEADING_PATTERN = /^##\s+/
const UNCHECKED_CHECKBOX_PATTERN = /^\s*[-*]\s*\[\s*\]\s*(.+)$/
const TODO_TASK_PATTERN = /^\d+\./
const FINAL_WAVE_TASK_PATTERN = /^F\d+\./i

type PlanSection = "todo" | "final-wave" | "other"

export type FinalWavePlanState = {
  pendingImplementationTaskCount: number
  pendingFinalWaveTaskCount: number
}

export function readFinalWavePlanState(planPath: string): FinalWavePlanState | null {
  if (!existsSync(planPath)) {
    return null
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    const lines = content.split(/\r?\n/)
    let section: PlanSection = "other"
    let pendingImplementationTaskCount = 0
    let pendingFinalWaveTaskCount = 0

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

      const taskLabel = uncheckedTaskMatch[1].trim()
      if (section === "todo" && TODO_TASK_PATTERN.test(taskLabel)) {
        pendingImplementationTaskCount += 1
      }

      if (section === "final-wave" && FINAL_WAVE_TASK_PATTERN.test(taskLabel)) {
        pendingFinalWaveTaskCount += 1
      }
    }

    return {
      pendingImplementationTaskCount,
      pendingFinalWaveTaskCount,
    }
  } catch {
    return null
  }
}
