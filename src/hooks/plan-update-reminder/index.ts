/**
 * Plan Update Reminder Hook
 *
 * PostToolUse hook that reminds agents to update planning files after code file changes.
 * Implements Manus principle of keeping plan files synchronized with work.
 * 
 * Reminds about:
 * - tasks.md: Update checkboxes when tasks are completed
 * - findings.md: Record discoveries and decisions (2-Action Rule)
 * - progress.md: Log actions and errors
 * 
 * NOTE: Only triggers for main session (Sisyphus), not for subagents.
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { readBoulderState } from "../../features/boulder-state"
import { subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"

const HOOK_NAME = "plan-update-reminder"

/** File patterns to exclude from reminder (already plan files or markdown) */
const EXCLUDED_PATTERNS = [
  /\.md$/i,
  /\.markdown$/i,
]

/** Track code changes per session for 2-Action Rule */
const sessionCodeChanges = new Map<string, number>()

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
      const sessionID = input.sessionID || "default"
      
      // Skip subagent sessions - they don't need planning file reminders
      if (subagentSessions.has(sessionID)) {
        return
      }
      
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
      
      // Track code changes for 2-Action Rule
      const currentCount = (sessionCodeChanges.get(sessionID) || 0) + 1
      sessionCodeChanges.set(sessionID, currentCount)
      
      // Build reminder based on change count
      let reminder: string
      
      if (currentCount % 2 === 0) {
        // Every 2 code changes: Full reminder (2-Action Rule)
        reminder = `

[PLANNING FILES REMINDER - 2-Action Rule]
You've made ${currentCount} code changes. Update your planning files:

1. **tasks.md**: If this completes a task, check it off: \`- [x]\`
2. **findings.md**: Record any discoveries, decisions, or issues encountered
3. **progress.md**: Log actions taken and any errors

> Manus Principle: "After every 2 operations, save findings to disk."`
      } else {
        // Odd changes: Simple reminder
        reminder = "\n\n[REMINDER] If this completes a task, update tasks.md. Record findings in findings.md."
      }
      
      if (output.output) {
        output.output += reminder
      } else {
        output.output = reminder
      }
      
      log(`[${HOOK_NAME}] Appended update reminder`, { 
        filePath, 
        plan: boulderState.plan_name,
        codeChangeCount: currentCount 
      })
    },
    
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const props = event.properties as Record<string, unknown> | undefined
      
      // Clean up on session end
      if (event.type === "session.deleted" || event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined
        if (sessionID) {
          sessionCodeChanges.delete(sessionID)
        }
      }
    },
  }
}
