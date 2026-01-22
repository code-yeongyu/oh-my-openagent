/**
 * Plan Attention Refresher Hook
 *
 * PreToolUse hook that refreshes tasks.md into the agent's attention window
 * before major tool operations. Implements Manus principle of "Attention Manipulation".
 *
 * Based on planning-with-files v2.4.1:
 * ```yaml
 * PreToolUse:
 *   - matcher: "Write|Edit|Bash|Read"
 *     hooks:
 *       - type: command
 *         command: "cat task_plan.md 2>/dev/null | head -30 || true"
 * ```
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { readBoulderState } from "../../features/boulder-state"
import { log } from "../../shared/logger"

const HOOK_NAME = "plan-attention-refresher"

/** Tools that trigger attention refresh */
const TRIGGER_TOOLS = new Set(["write", "edit", "bash", "read"])

/** Maximum lines to read from tasks.md */
const MAX_LINES = 30

/** Session-scoped tracking to avoid refreshing too frequently */
const lastRefreshTime = new Map<string, number>()

/** Minimum interval between refreshes (ms) - 60 seconds */
const REFRESH_INTERVAL = 60_000

/**
 * Read the first N lines from a file
 */
function readFirstLines(filePath: string, maxLines: number): string | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }
    const content = readFileSync(filePath, "utf-8")
    const lines = content.split("\n").slice(0, maxLines)
    return lines.join("\n")
  } catch {
    return null
  }
}

/**
 * Check if we should refresh based on time interval
 */
function shouldRefresh(sessionId: string): boolean {
  const now = Date.now()
  const lastRefresh = lastRefreshTime.get(sessionId) ?? 0
  
  if (now - lastRefresh < REFRESH_INTERVAL) {
    return false
  }
  
  lastRefreshTime.set(sessionId, now)
  return true
}

export function createPlanAttentionRefresherHook(ctx: PluginInput) {
  return {
    name: HOOK_NAME,
    
    async handler({ event, sessionID }: { event: { type: string; properties?: unknown }; sessionID?: string }): Promise<void> {
      if (event.type !== "tool.execute.before") {
        return
      }
      
      const props = event.properties as {
        tool?: string
        input?: Record<string, unknown>
        output?: { output?: string }
      } | undefined
      
      if (!props) return
      
      const toolName = props.tool?.toLowerCase()
      
      // Only trigger on specific tools
      if (!toolName || !TRIGGER_TOOLS.has(toolName)) {
        return
      }
      
      const sessionId = sessionID ?? "unknown"
      
      // Check refresh interval
      if (!shouldRefresh(sessionId)) {
        return
      }
      
      // Check if boulder.json exists and has active plan
      const boulderState = readBoulderState(ctx.directory)
      if (!boulderState || !boulderState.active_plan) {
        return
      }
      
      // Construct path to tasks.md
      const tasksPath = join(ctx.directory, boulderState.active_plan)
      
      // Read first 30 lines
      const preview = readFirstLines(tasksPath, MAX_LINES)
      if (!preview) {
        log(`[${HOOK_NAME}] Could not read tasks.md at ${tasksPath}`)
        return
      }
      
      // Prepend to output as context refresh
      const refreshHeader = `\n[PLAN CONTEXT - ${boulderState.plan_name}]\n`
      const refreshContent = `\`\`\`markdown\n${preview}\n\`\`\`\n`
      const refreshFooter = `[/PLAN CONTEXT]\n\n`
      
      const fullRefresh = refreshHeader + refreshContent + refreshFooter
      
      // Modify the output object
      const output = props.output as { output?: string } | undefined
      if (output) {
        if (output.output) {
          output.output = fullRefresh + output.output
        } else {
          output.output = fullRefresh
        }
      }
      
      log(`[${HOOK_NAME}] Refreshed plan context`, { 
        plan: boulderState.plan_name,
        tool: toolName,
        lines: preview.split("\n").length
      })
    },
  }
}
