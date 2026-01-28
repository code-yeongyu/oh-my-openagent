import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"

const HOOK_NAME = "loop-detector"

export const LOOP_THRESHOLDS = {
  sameToolCall: 3,
  sameErrorPattern: 2,
  historyWindow: 10,
  alternatingPatternLength: 6,
} as const

export interface ToolCallRecord {
  tool: string
  args: Record<string, unknown>
  timestamp: number
  error?: string
}

export interface LoopDetection {
  type: "repeated_call" | "error_loop" | "alternating_pattern"
  pattern: string
  count: number
  recommendation: string
}

interface SessionLoopState {
  history: ToolCallRecord[]
  loopDetectedAt?: number
  warningCount: number
}

const sessionStates = new Map<string, SessionLoopState>()

function getState(sessionID: string): SessionLoopState {
  let state = sessionStates.get(sessionID)
  if (!state) {
    state = { history: [], warningCount: 0 }
    sessionStates.set(sessionID, state)
  }
  return state
}

function argsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false
  }
  return true
}

function findRepeatedCalls(history: ToolCallRecord[]): { pattern: ToolCallRecord; count: number } | null {
  if (history.length < LOOP_THRESHOLDS.sameToolCall) return null

  const recent = history.slice(-LOOP_THRESHOLDS.historyWindow)
  const countMap = new Map<string, { record: ToolCallRecord; count: number }>()

  for (const record of recent) {
    const key = `${record.tool}:${JSON.stringify(record.args)}`
    const existing = countMap.get(key)
    if (existing) {
      existing.count++
    } else {
      countMap.set(key, { record, count: 1 })
    }
  }

  for (const { record, count } of countMap.values()) {
    if (count >= LOOP_THRESHOLDS.sameToolCall) {
      return { pattern: record, count }
    }
  }

  return null
}

function findErrorLoop(history: ToolCallRecord[]): { pattern: string; count: number } | null {
  const recent = history.slice(-LOOP_THRESHOLDS.historyWindow)
  const errors = recent.filter(r => r.error)

  if (errors.length < LOOP_THRESHOLDS.sameErrorPattern) return null

  const errorCounts = new Map<string, number>()
  for (const record of errors) {
    const key = record.error ?? ""
    errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1)
  }

  for (const [pattern, count] of errorCounts) {
    if (count >= LOOP_THRESHOLDS.sameErrorPattern) {
      return { pattern, count }
    }
  }

  return null
}

function findAlternatingPattern(history: ToolCallRecord[]): boolean {
  if (history.length < LOOP_THRESHOLDS.alternatingPatternLength) return false

  const recent = history.slice(-LOOP_THRESHOLDS.alternatingPatternLength)
  const tools = recent.map(r => r.tool)

  if (tools.length < 4) return false

  const pattern = [tools[0], tools[1]]
  let matches = 0

  for (let i = 0; i < tools.length - 1; i += 2) {
    if (tools[i] === pattern[0] && tools[i + 1] === pattern[1]) {
      matches++
    }
  }

  return matches >= 3
}

export function detectLoop(history: ToolCallRecord[]): LoopDetection | null {
  const repeated = findRepeatedCalls(history)
  if (repeated) {
    return {
      type: "repeated_call",
      pattern: `${repeated.pattern.tool}(${JSON.stringify(repeated.pattern.args)})`,
      count: repeated.count,
      recommendation: "Try a different approach or file path",
    }
  }

  const errorLoop = findErrorLoop(history)
  if (errorLoop) {
    return {
      type: "error_loop",
      pattern: errorLoop.pattern,
      count: errorLoop.count,
      recommendation: "Read the file first to understand its current state",
    }
  }

  if (findAlternatingPattern(history)) {
    return {
      type: "alternating_pattern",
      pattern: "read-edit-read-edit cycle",
      count: LOOP_THRESHOLDS.alternatingPatternLength,
      recommendation: "Stop and analyze why edits are failing",
    }
  }

  return null
}

function createLoopWarning(detection: LoopDetection): string {
  return `[LOOP DETECTED - ${detection.type.toUpperCase()}]

Pattern: ${detection.pattern}
Occurrences: ${detection.count}

STOP. You are in a loop. This wastes tokens and does not make progress.

Recommendation: ${detection.recommendation}

Before continuing:
1. Analyze WHY the previous attempts failed
2. Try a DIFFERENT approach
3. If stuck, ask the user for guidance`
}

export interface LoopDetectorHook {
  "tool.execute.before": (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown>; output?: string }
  ) => Promise<{ args: Record<string, unknown>; output?: string }>
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
}

export function createLoopDetectorHook(_ctx: PluginInput): LoopDetectorHook {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; output?: string }
    ): Promise<{ args: Record<string, unknown>; output?: string }> => {
      const sessionID = input.sessionID
      if (!sessionID) return output

      const state = getState(sessionID)
      const toolName = input.tool
      const toolArgs = (output.args ?? {}) as Record<string, unknown>

      const record: ToolCallRecord = {
        tool: toolName,
        args: toolArgs,
        timestamp: Date.now(),
      }

      state.history.push(record)

      if (state.history.length > 50) {
        state.history = state.history.slice(-30)
      }

      const detection = detectLoop(state.history)

      if (detection) {
        state.warningCount++
        log(`[${HOOK_NAME}] Loop detected`, {
          sessionID,
          type: detection.type,
          pattern: detection.pattern,
          count: detection.count,
          warningCount: state.warningCount,
        })

        const warning = createLoopWarning(detection)
        output.output = output.output ? `${output.output}\n\n${warning}` : warning

        if (state.warningCount >= 3) {
          log(`[${HOOK_NAME}] Multiple warnings issued, consider blocking`, { sessionID })
        }
      }

      return output
    },

    event: async ({ event }): Promise<void> => {
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "tool.execute.after") {
        const sessionID = props?.sessionID as string | undefined
        const error = props?.error as string | undefined

        if (sessionID && error) {
          const state = getState(sessionID)
          const lastRecord = state.history[state.history.length - 1]
          if (lastRecord) {
            lastRecord.error = error
          }
        }
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          sessionStates.delete(sessionInfo.id)
          log(`[${HOOK_NAME}] Cleaned up session state`, { sessionID: sessionInfo.id })
        }
      }
    },
  }
}

export default createLoopDetectorHook
