import { existsSync, readFileSync } from "node:fs"
import { isStructuredTaskRow } from "../../features/boulder-state"

const TODO_HEADING_PATTERN = /^##\s+TODOs\b/i
const FINAL_VERIFICATION_HEADING_PATTERN = /^##\s+Final Verification Wave\b/i
const SECOND_LEVEL_HEADING_PATTERN = /^##\s+/
const UNCHECKED_CHECKBOX_PATTERN = /^\s*[-*]\s*\[\s*\]\s*(.+)$/

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

      if (section === "other" || !UNCHECKED_CHECKBOX_PATTERN.test(line)) {
        continue
      }

      if (!isStructuredTaskRow(line, section)) {
        continue
      }

      if (section === "todo") {
        pendingImplementationTaskCount += 1
      }

      if (section === "final-wave") {
        pendingFinalWaveTaskCount += 1
      }
    }

    return {
      pendingImplementationTaskCount,
      pendingFinalWaveTaskCount,
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return null
  }
}
