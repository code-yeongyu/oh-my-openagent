import type { BackgroundTaskConfig } from "../../config/schema"
import {
  DEFAULT_CIRCUIT_BREAKER_ENABLED,
  DEFAULT_CIRCUIT_BREAKER_CONSECUTIVE_THRESHOLD,
  DEFAULT_MAX_TOOL_CALLS,
} from "./constants"
import type { ToolCallWindow } from "./types"

export interface CircuitBreakerSettings {
  enabled: boolean
  maxToolCalls: number
  consecutiveThreshold: number
}

export interface ToolLoopDetectionResult {
  triggered: boolean
  toolName?: string
  repeatedCount?: number
}

export function resolveCircuitBreakerSettings(
  config?: BackgroundTaskConfig
): CircuitBreakerSettings {
  return {
    enabled: config?.circuitBreaker?.enabled ?? DEFAULT_CIRCUIT_BREAKER_ENABLED,
    maxToolCalls:
      config?.circuitBreaker?.maxToolCalls ?? config?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
    consecutiveThreshold:
      config?.circuitBreaker?.consecutiveThreshold ?? DEFAULT_CIRCUIT_BREAKER_CONSECUTIVE_THRESHOLD,
  }
}

export function recordToolCall(
  window: ToolCallWindow | undefined,
  toolName: string,
  settings: CircuitBreakerSettings,
  toolInput?: Record<string, unknown> | null
): ToolCallWindow {
  const signature = createToolCallSignature(toolName, toolInput)

  if (window && window.lastSignature === signature) {
    return {
      lastSignature: signature,
      consecutiveCount: window.consecutiveCount + 1,
      threshold: settings.consecutiveThreshold,
    }
  }

  return {
    lastSignature: signature,
    consecutiveCount: 1,
    threshold: settings.consecutiveThreshold,
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
  if (!window || window.consecutiveCount < window.threshold) {
    return { triggered: false }
  }

  return {
    triggered: true,
    toolName: window.lastSignature.split("::")[0],
    repeatedCount: window.consecutiveCount,
  }
}
