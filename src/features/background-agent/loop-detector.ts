import type { BackgroundTaskConfig } from "../../config/schema"
import {
  DEFAULT_CIRCUIT_BREAKER_ENABLED,
  DEFAULT_CIRCUIT_BREAKER_REPETITION_THRESHOLD_PERCENT,
  DEFAULT_CIRCUIT_BREAKER_WINDOW_SIZE,
  DEFAULT_MAX_TOOL_CALLS,
} from "./constants"
import type { ToolCallWindow } from "./types"

export interface CircuitBreakerSettings {
  enabled: boolean
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
    enabled: config?.circuitBreaker?.enabled ?? DEFAULT_CIRCUIT_BREAKER_ENABLED,
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
  settings: CircuitBreakerSettings,
  toolInput?: Record<string, unknown> | null
): ToolCallWindow {
  const previous = window?.toolSignatures ?? []
  const signature = createToolCallSignature(toolName, toolInput)
  const toolSignatures = [...previous, signature].slice(-settings.windowSize)

  return {
    toolSignatures,
    windowSize: settings.windowSize,
    thresholdPercent: settings.repetitionThresholdPercent,
  }
}

function sortObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== "object") return obj
  if (Array.isArray(obj)) return obj.map(sortObject)

  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  for (const key of keys) {
    sorted[key] = sortObject((obj as Record<string, unknown>)[key])
  }
  return sorted
}

export function createToolCallSignature(
  toolName: string,
  toolInput?: Record<string, unknown> | null
): string {
  if (toolInput === undefined || toolInput === null) {
    return toolName
  }
  if (Object.keys(toolInput).length === 0) {
    return toolName
  }
  return `${toolName}::${JSON.stringify(sortObject(toolInput))}`
}

export function detectRepetitiveToolUse(
  window: ToolCallWindow | undefined
): ToolLoopDetectionResult {
  if (!window || window.toolSignatures.length === 0) {
    return { triggered: false }
  }

  const counts = new Map<string, number>()
  for (const signature of window.toolSignatures) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1)
  }

  let repeatedTool: string | undefined
  let repeatedCount = 0

  for (const [toolName, count] of counts.entries()) {
    if (count > repeatedCount) {
      repeatedTool = toolName
      repeatedCount = count
    }
  }

  const sampleSize = window.toolSignatures.length
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
    toolName: repeatedTool.split("::")[0],
    repeatedCount,
    sampleSize,
    thresholdPercent: window.thresholdPercent,
  }
}
