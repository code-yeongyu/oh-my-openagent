import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { HOOK_NAME, VERIFICATION_REMINDER, DELEGATE_TASK_TOOL } from "./constants"

export * from "./constants"

/**
 * Creates the Subagent Verification hook.
 *
 * This hook injects verification reminders after delegate_task completes,
 * enforcing the "Subagents Lie" principle by reminding the orchestrator
 * to independently verify all delegated work.
 */
export function createSubagentVerificationHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: {
        sessionID: string
        tool: string
        args?: Record<string, unknown>
      },
      output: {
        result?: unknown
        output: string
      }
    ): Promise<void> => {
      const { sessionID, tool } = input
      const args = input.args ?? {}

      // Only inject reminder for delegate_task completions
      if (tool !== DELEGATE_TASK_TOOL) {
        return
      }

      // Skip if this was a background task (async)
      const runInBackground = args.run_in_background as boolean | undefined
      if (runInBackground) {
        return
      }

      // Check if the task completed successfully
      const resultStr = typeof output.result === "string" 
        ? output.result 
        : JSON.stringify(output.result)
      
      // Skip if task failed or was cancelled
      if (/failed|error|cancelled|timeout/i.test(resultStr) && !/no error/i.test(resultStr)) {
        log(`[${HOOK_NAME}] Skipping verification reminder - task failed`, { sessionID })
        return
      }

      log(`[${HOOK_NAME}] Injecting verification reminder`, { sessionID })
      output.output += `\n\n${VERIFICATION_REMINDER}`
    },
  }
}
