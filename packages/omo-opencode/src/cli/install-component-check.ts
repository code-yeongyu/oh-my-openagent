import { buildComponentIssues, gatherComponents } from "./doctor/checks/components"
import type { DoctorComponentOptions } from "./doctor/framework/types"

export interface ComponentCheckLog {
  readonly info: (message: string) => void
  readonly warn: (message: string) => void
}

/**
 * Runs the doctor's component probes after an install and reports what does not work.
 * It never fails the install and never installs anything: a missing optional server is
 * advice, not an error, and the fixes are printed for the user to choose from.
 */
export async function reportComponentHealth(log: ComponentCheckLog, options: DoctorComponentOptions = {}): Promise<void> {
  try {
    const report = await gatherComponents(options)
    const issues = buildComponentIssues(report)
    if (issues.length === 0) {
      log.info("Components verified: language servers and tools in this directory answered their probes.")
      return
    }
    for (const issue of issues) {
      log.warn(`${issue.title} - ${issue.description}${issue.fix === undefined ? "" : ` Fix: ${issue.fix}`}`)
    }
    log.info("Run `oh-my-opencode doctor --verbose` for the full component report.")
  } catch (error) {
    log.warn(`Component check skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}
