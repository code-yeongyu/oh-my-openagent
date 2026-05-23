/**
 * Agent performance analytics hook
 * Captures metrics on tool execution and agent delegation
 */

import { captureToolCall, captureDelegation } from "../features/agent-analytics"
import { getSessionAgent } from "../features/claude-code-session-state"

const activeTimers = new Map<string, number>()

export function createAgentAnalyticsHook() {
  return {
    "tool.execute.before": async (input: {
      tool: string
      sessionID: string
      callID: string
    }) => {
      const timerKey = `${input.sessionID}:${input.callID}`
      activeTimers.set(timerKey, Date.now())
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      const timerKey = `${input.sessionID}:${input.callID}`
      const startTime = activeTimers.get(timerKey)
      activeTimers.delete(timerKey)

      if (!startTime) return

      const durationMs = Date.now() - startTime
      const success = !output.output?.toString().includes("Error:")

      // Get agent name from session context
      const agentName = getSessionAgent(input.sessionID) ?? "unknown"
      const category = "unknown"

      captureToolCall(
        input.sessionID,
        agentName,
        input.tool,
        durationMs,
        success,
      )
    },
  }
}
