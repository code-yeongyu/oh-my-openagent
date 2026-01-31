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
import { resolve } from "node:path"
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

/** Store filePath from tool.execute.before for use in tool.execute.after */
const pendingFilePaths = new Map<string, string>()

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
    
    // Capture filePath in tool.execute.before (where output.args is available)
    "tool.execute.before": async (
      input: { tool: string; sessionID?: string; callID?: string },
      output: { args?: Record<string, unknown> }
    ): Promise<void> => {
      const toolName = input.tool.toLowerCase()
      
      // Only capture for Edit or Write tools
      if (toolName !== "edit" && toolName !== "write") {
        return
      }
      
      // Get file path from args
      const filePath = (output.args?.filePath ?? output.args?.file_path ?? output.args?.path) as string | undefined
      
      if (filePath && input.callID) {
        pendingFilePaths.set(input.callID, filePath)
        log(`[${HOOK_NAME}] DEBUG - Stored filePath`, { callID: input.callID, filePath })
      }
    },
    
    "tool.execute.after": async (
      input: { tool: string; sessionID?: string; callID?: string },
      output: { output?: string }
    ): Promise<void> => {
      const toolName = input.tool.toLowerCase()
      const sessionID = input.sessionID || "default"
      
      // DEBUG: Log tool.execute.after call
      log(`[${HOOK_NAME}] DEBUG - tool.execute.after`, {
        toolName,
        callID: input.callID,
        sessionID,
        pendingSize: pendingFilePaths.size
      })
      
      // Only trigger on Edit or Write tools
      if (toolName !== "edit" && toolName !== "write") {
        return
      }
      
      // Get filePath from pendingFilePaths (captured in tool.execute.before)
      const filePath = input.callID ? pendingFilePaths.get(input.callID) : undefined
      
      log(`[${HOOK_NAME}] DEBUG - Retrieved filePath`, {
        callID: input.callID,
        filePath,
        found: !!filePath
      })
      
      // Clean up pending entry
      if (input.callID) {
        pendingFilePaths.delete(input.callID)
      }
      
      // Skip subagent sessions - they don't need planning file reminders
      if (subagentSessions.has(sessionID)) {
        log(`[${HOOK_NAME}] DEBUG - Skipping: subagent session`)
        return
      }
      
      if (!filePath) {
        log(`[${HOOK_NAME}] DEBUG - Skipping: no filePath`)
        return
      }
      
      // Skip markdown files (including tasks.md)
      if (!shouldTriggerReminder(filePath)) {
        log(`[${HOOK_NAME}] DEBUG - Skipping: markdown file`)
        return
      }
      
      // Check if boulder.json exists and has active plan
      // Use resolve() to handle Windows path issues
      const resolvedDir = resolve(ctx.directory)
      const boulderState = readBoulderState(resolvedDir)
      if (!boulderState || !boulderState.active_plan) {
        log(`[${HOOK_NAME}] DEBUG - Skipping: no boulder state`, { 
          boulderState, 
          directory: ctx.directory,
          resolvedDir
        })
        return
      }
      
      log(`[${HOOK_NAME}] DEBUG - All checks passed, appending reminder`)
      
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
