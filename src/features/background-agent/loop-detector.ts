import type { BackgroundTaskConfig } from "../../config/schema"
import {
  DEFAULT_CIRCUIT_BREAKER_REPETITION_THRESHOLD_PERCENT,
  DEFAULT_CIRCUIT_BREAKER_WINDOW_SIZE,
  DEFAULT_MAX_TOOL_CALLS,
} from "./constants"
import type { ToolCallWindow } from "./types"

export interface CircuitBreakerSettings {
  maxToolCalls: number
  windowSize: number
  repetitionThresholdPercent: number
}

export interface ToolLoopDetectionResult {
  triggered: boolean
  toolName?: string
  repeatedCount?: number
  sampleSize?: number
  thresholdPercent?: number
}

export function resolveCircuitBreakerSettings(
  config?: BackgroundTaskConfig
): CircuitBreakerSettings {
  return {
    maxToolCalls:
      config?.circuitBreaker?.maxToolCalls ?? config?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
    windowSize: config?.circuitBreaker?.windowSize ?? DEFAULT_CIRCUIT_BREAKER_WINDOW_SIZE,
    repetitionThresholdPercent:
      config?.circuitBreaker?.repetitionThresholdPercent ??
      DEFAULT_CIRCUIT_BREAKER_REPETITION_THRESHOLD_PERCENT,
  }
}

export function recordToolCall(
  window: ToolCallWindow | undefined,
  toolName: string,
  settings: CircuitBreakerSettings
): ToolCallWindow {
  const previous = window?.toolNames ?? []
  const toolNames = [...previous, toolName].slice(-settings.windowSize)

  return {
    toolNames,
    windowSize: settings.windowSize,
    thresholdPercent: settings.repetitionThresholdPercent,
  }
}

export function detectRepetitiveToolUse(
  window: ToolCallWindow | undefined
): ToolLoopDetectionResult {
  if (!window || window.toolNames.length === 0) {
    return { triggered: false }
  }

  const counts = new Map<string, number>()
  for (const toolName of window.toolNames) {
    counts.set(toolName, (counts.get(toolName) ?? 0) + 1)
  }

  let repeatedTool: string | undefined
  let repeatedCount = 0

  for (const [toolName, count] of counts.entries()) {
    if (count > repeatedCount) {
      repeatedTool = toolName
      repeatedCount = count
    }
  }

  const sampleSize = window.toolNames.length
  const minimumSampleSize = Math.min(
    window.windowSize,
    Math.ceil((window.windowSize * window.thresholdPercent) / 100)
  )

  if (sampleSize < minimumSampleSize) {
    return { triggered: false }
  }

  const thresholdCount = Math.ceil((sampleSize * window.thresholdPercent) / 100)

  if (!repeatedTool || repeatedCount < thresholdCount) {
    return { triggered: false }
  }

  return {
    triggered: true,
    toolName: repeatedTool,
    repeatedCount,
    sampleSize,
    thresholdPercent: window.thresholdPercent,
  }
}
