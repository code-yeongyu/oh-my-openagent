export interface ToolCallRecord {
  tool: string
  timestamp: number
  success: boolean
}

export interface SessionState {
  lastTool: string
  consecutiveCount: number
  consecutiveFailures: number
  totalCalls: number
  recentCalls: ToolCallRecord[]
}

const MAX_RECENT_CALLS = 20

export class AnomalyDetector {
  private sessionStates = new Map<string, SessionState>()

  private getOrCreateState(sessionID: string): SessionState {
    if (!this.sessionStates.has(sessionID)) {
      this.sessionStates.set(sessionID, {
        lastTool: "",
        consecutiveCount: 0,
        consecutiveFailures: 0,
        totalCalls: 0,
        recentCalls: [],
      })
    }
    return this.sessionStates.get(sessionID)!
  }

  recordToolCall(sessionID: string, toolName: string, success: boolean): void {
    const state = this.getOrCreateState(sessionID)
    state.recentCalls.push({
      tool: toolName,
      timestamp: Date.now(),
      success,
    })
    if (state.recentCalls.length > MAX_RECENT_CALLS) {
      state.recentCalls.shift()
    }
  }

  detectLoop(sessionID: string, toolName: string): string | null {
    const state = this.getOrCreateState(sessionID)

    if (state.lastTool === toolName) {
      state.consecutiveCount++
      if (state.consecutiveCount >= 3) {
        return `[observer-detector] ⚠️ Potential loop detected: tool '${toolName}' called ${state.consecutiveCount} times consecutively in session ${sessionID}`
      }
    } else {
      state.lastTool = toolName
      state.consecutiveCount = 1
    }

    return null
  }

  detectFailure(sessionID: string, output: string): boolean {
    const isFailure =
      output.toLowerCase().includes("error") ||
      output.toLowerCase().includes("failed") ||
      output.toLowerCase().includes("could not")
    return isFailure
  }

  trackFailure(sessionID: string, isFailure: boolean): string | null {
    const state = this.getOrCreateState(sessionID)

    if (isFailure) {
      state.consecutiveFailures++
      if (state.consecutiveFailures >= 2) {
        return `[observer-detector] ⚠️ Detected ${state.consecutiveFailures} consecutive failures in session ${sessionID}`
      }
    } else {
      state.consecutiveFailures = 0
    }

    return null
  }

  incrementCallCounter(sessionID: string): { shouldTriggerL2: boolean; message: string | null } {
    const state = this.getOrCreateState(sessionID)
    state.totalCalls++

    if (state.totalCalls % 20 === 0) {
      return {
        shouldTriggerL2: true,
        message: `[observer-detector] 📊 ${state.totalCalls} tool calls reached in session ${sessionID}. Triggering L2 analysis.`,
      }
    }

    return { shouldTriggerL2: false, message: null }
  }

  getRecentCallsSummary(sessionID: string): string {
    const state = this.sessionStates.get(sessionID)
    if (!state || state.recentCalls.length === 0) {
      return "No recent tool calls recorded."
    }

    const toolCounts = new Map<string, { total: number; failures: number }>()
    for (const call of state.recentCalls) {
      const existing = toolCounts.get(call.tool) || { total: 0, failures: 0 }
      existing.total++
      if (!call.success) existing.failures++
      toolCounts.set(call.tool, existing)
    }

    const lines = [`Last ${state.recentCalls.length} tool calls:`]
    for (const [tool, counts] of toolCounts) {
      const failureInfo = counts.failures > 0 ? ` (${counts.failures} failed)` : ""
      lines.push(`  - ${tool}: ${counts.total}${failureInfo}`)
    }

    return lines.join("\n")
  }

  cleanup(sessionID: string): void {
    this.sessionStates.delete(sessionID)
  }

  getState(sessionID: string): SessionState | undefined {
    return this.sessionStates.get(sessionID)
  }
}
