/**
 * Plan Update Reminder Hook
 *
 * PostToolUse hook that reminds agents to update tasks.md after code file changes.
 * Implements Manus principle of keeping plan files synchronized with work.
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { readBoulderState } from "../../features/boulder-state"
import { log } from "../../shared/logger"

const HOOK_NAME = "plan-update-reminder"

/** File patterns to exclude from reminder (already plan files or markdown) */
const EXCLUDED_PATTERNS = [
  /\.md$/i,
  /\.markdown$/i,
]

/**
 * Check if a file path should trigger the reminder
 * Returns false for markdown files (including tasks.md)
 */
function shouldTriggerReminder(filePath: string): boolean {
  return !EXCLUDED_PATTERNS.some(pattern => pattern.test(filePath))
}

export function createPlanUpdateReminderHook(ctx: PluginInput) {
  return {
    name: HOOK_NAME,
    
    "tool.execute.after": async (
      input: { tool: string; input?: { filePath?: string; path?: string }; sessionID?: string },
      output: { output?: string }
    ): Promise<void> => {
      const toolName = input.tool
      
      // Only trigger on Edit or Write tools
      if (toolName !== "edit" && toolName !== "write") {
        return
      }
      
      // Get file path from input
      const filePath = input.input?.filePath || input.input?.path
      if (!filePath) {
        return
      }
      
      // Skip markdown files (including tasks.md)
      if (!shouldTriggerReminder(filePath)) {
        return
      }
      
      // Check if boulder.json exists and has active plan
      const boulderState = readBoulderState(ctx.directory)
      if (!boulderState || !boulderState.active_plan) {
        return
      }
      
      // Append reminder to output
      const reminder = "\n\n[REMINDER] If this completes a task, update tasks.md."
      
      if (output.output) {
        output.output += reminder
      } else {
        output.output = reminder
      }
      
      log(`[${HOOK_NAME}] Appended update reminder`, { filePath, plan: boulderState.plan_name })
    },
  }
}
