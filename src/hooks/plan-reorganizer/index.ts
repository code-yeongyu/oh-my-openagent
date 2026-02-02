/**
 * Plan Reorganizer Hook
 *
 * PostToolUse hook that triggers plan reorganization after Edit/Write to tasks.md.
 * Moves completed phases to the bottom of the document.
 * Integrates phase-rollback for failure analysis and recovery suggestions.
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { reorganizePlan } from "../../features/plan-reorganizer"
import { log } from "../../shared/logger"
import {
  createPhaseRollback,
  type PhaseRollback,
  type RollbackHistory,
} from "../../shared/phase-rollback"

const HOOK_NAME = "plan-reorganizer"

/** File patterns that trigger reorganization */
const PLAN_FILE_PATTERNS = [
  /[/\\]tasks\.md$/i,
  /[/\\]task_plan\.md$/i,
]

/**
 * Check if a file path matches plan file patterns
 */
function isPlanFile(filePath: string): boolean {
  return PLAN_FILE_PATTERNS.some(pattern => pattern.test(filePath))
}

export function createPlanReorganizerHook(ctx: PluginInput) {
  // Initialize phase rollback manager at verification phase (plan reorganization is a verification step)
  const phaseRollback: PhaseRollback = createPhaseRollback("verification")

  return {
    name: HOOK_NAME,

    /**
     * Get the rollback history for debugging purposes
     */
    getRollbackHistory(): RollbackHistory[] {
      return phaseRollback.getHistory()
    },

    /**
     * Clear the rollback history
     */
    clearRollbackHistory(): void {
      phaseRollback.clearHistory()
    },

    async handler({ event }: { event: { type: string; properties?: unknown } }): Promise<void> {
      if (event.type !== "tool.execute.after") {
        return
      }

      const props = event.properties as {
        tool?: string
        input?: { filePath?: string; path?: string }
        output?: unknown
      } | undefined

      if (!props) return

      const toolName = props.tool

      // Only trigger on Edit or Write tools
      if (toolName !== "edit" && toolName !== "write") {
        return
      }

      // Get file path from input
      const filePath = props.input?.filePath || props.input?.path
      if (!filePath) {
        return
      }

      // Check if this is a plan file
      if (!isPlanFile(filePath)) {
        return
      }

      // Reorganize the plan (silently, don't block)
      try {
        const changed = reorganizePlan(filePath)
        if (changed) {
          log(`[${HOOK_NAME}] Reorganized plan file`, { filePath })
        }
      } catch (err) {
        const errorMessage = String(err)
        log(`[${HOOK_NAME}] Failed to reorganize plan`, { filePath, error: errorMessage })

        // Use phase-rollback to analyze the failure
        const failureReason = phaseRollback.extractFailureReason(errorMessage)
        const suggestedPhase = phaseRollback.suggestRollbackPhase(failureReason)

        // Record the rollback for debugging
        phaseRollback.rollbackTo(suggestedPhase, errorMessage)

        log(`[${HOOK_NAME}] Phase rollback suggested`, {
          filePath,
          failurePhase: failureReason.phase,
          suggestedRollbackTo: suggestedPhase,
        })
      }
    },
  }
}
