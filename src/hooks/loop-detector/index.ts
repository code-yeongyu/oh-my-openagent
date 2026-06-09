import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { resolveSessionEventID } from "../../shared/event-session-id"

const HOOK_NAME = "loop-detector"

export const LOOP_THRESHOLDS = {
  sameToolCall: 3,
  sameErrorPattern: 2,
  historyWindow: 10,
  alternatingPatternLength: 6,
} as const

export interface ToolCallRecord {
  readonly tool: string
  readonly args: Record<string, unknown>
  readonly timestamp: number
  error?: string
}

export interface LoopDetection {
  readonly type: "repeated_call" | "error_loop" | "alternating_pattern"
  readonly pattern: string
  readonly count: number
  readonly recommendation: string
}

interface SessionLoopState {
  history: ToolCallRecord[]
  loopDetectedAt?: number
  warningCount: number
}

interface ToolExecuteBeforeInput {
  readonly tool: string
  readonly sessionID: string
  readonly callID: string
}

interface ToolExecuteBeforeOutput {
  readonly args: Record<string, unknown>
  message?: string
}

interface EventInput {
  readonly event: {
    readonly type: string
    readonly properties?: unknown
  }
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

function appendMessage(output: ToolExecuteBeforeOutput, message: string): void {
  output.message = output.message ? `${output.message}\n\n${message}` : message
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export interface LoopDetectorHook {
  "tool.execute.before": (
    input: ToolExecuteBeforeInput,
    output: ToolExecuteBeforeOutput
  ) => Promise<void>
  event: (input: EventInput) => Promise<void>
}

export function createLoopDetectorHook(_ctx?: PluginInput): LoopDetectorHook {
  return {
    "tool.execute.before": async (
      input: ToolExecuteBeforeInput,
      output: ToolExecuteBeforeOutput
    ): Promise<void> => {
      const sessionID = input.sessionID
      if (!sessionID) return

      const state = getState(sessionID)
      const toolName = input.tool
      const toolArgs = output.args

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
        state.loopDetectedAt = Date.now()
        state.warningCount++
        log(`[${HOOK_NAME}] Loop detected`, {
          sessionID,
          type: detection.type,
          pattern: detection.pattern,
          count: detection.count,
          warningCount: state.warningCount,
          loopDetectedAt: state.loopDetectedAt,
        })

        const warning = createLoopWarning(detection)
        appendMessage(output, warning)

        if (state.warningCount >= 3) {
          log(`[${HOOK_NAME}] Multiple warnings issued, consider blocking`, { sessionID })
        }
      }
    },

    event: async ({ event }): Promise<void> => {
      const props = isRecord(event.properties) ? event.properties : undefined

      if (event.type === "tool.execute.after") {
        const sessionID = typeof props?.sessionID === "string" ? props.sessionID : undefined
        const error = typeof props?.error === "string" ? props.error : undefined

        if (sessionID && error) {
          const state = getState(sessionID)
          const lastRecord = state.history[state.history.length - 1]
          if (lastRecord) {
            lastRecord.error = error
          }
        }
      }

      if (event.type === "session.deleted") {
        const sessionID = resolveSessionEventID(props)
        if (sessionID) {
          sessionStates.delete(sessionID)
          log(`[${HOOK_NAME}] Cleaned up session state`, { sessionID })
        }
      }
    },
  }
}
