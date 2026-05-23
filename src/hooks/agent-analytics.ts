/**
 * Agent performance analytics hook
 * Captures metrics on tool execution and agent delegation
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { recordMetric } from "../features/agent-analytics"

const activeTimers = new Map<string, number>()

export function createAgentAnalyticsHook(_ctx: PluginInput) {
  const toolExecuteBefore = async (input: {
    tool: string
    sessionID: string
    callID: string
  }) => {
    const timerKey = `${input.sessionID}:${input.callID}`
    activeTimers.set(timerKey, Date.now())
  }

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ) => {
    const timerKey = `${input.sessionID}:${input.callID}`
    const startTime = activeTimers.get(timerKey)
    activeTimers.delete(timerKey)

    if (!startTime) return

    const durationMs = Date.now() - startTime
    const success = !output.output?.toString().includes("Error:")

    recordMetric({
      id: `${input.sessionID}-${input.callID}`,
      timestamp: new Date(),
      sessionId: input.sessionID,
      agentName: "unknown",
      category: "unknown",
      eventType: "tool_call",
      toolName: input.tool,
      durationMs,
      success,
    })
  }

  return {
    toolExecuteBefore,
    toolExecuteAfter,
  }
}
