import { HOOK_NAME, NATIVE_PLAN_TOOLS, buildPlanToolDenialMessage } from "./constants"
import { log } from "../../shared/logger"
import { subagentSessions } from "../../features/claude-code-session-state/state"

/**
 * Denies OpenCode native plan_enter/plan_exit inside delegated subagent
 * sessions. Primary sessions keep the native plan flow untouched; subagents
 * must finish their turn and hand the plan back as their final message
 * instead of triggering the primary-TUI plan handoff (#5850).
 */
export function createPlanExitSubagentGuardHook() {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      if (!NATIVE_PLAN_TOOLS.includes(input.tool)) {
        return
      }

      if (!subagentSessions.has(input.sessionID)) {
        return
      }

      log(`[${HOOK_NAME}] Denied native plan tool in delegated subagent session`, {
        sessionID: input.sessionID,
        tool: input.tool,
        callID: input.callID,
      })

      throw new Error(buildPlanToolDenialMessage(input.tool))
    },
  }
}
