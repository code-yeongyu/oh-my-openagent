import { getAnalyticsDb } from "./storage"
import type { AgentMetricEvent } from "./types"

export function recordMetric(event: AgentMetricEvent): void {
  const db = getAnalyticsDb()

  db.run(
    `INSERT INTO agent_metrics (id, timestamp, session_id, agent_name, category, event_type, tool_name, duration_ms, success, error_type, token_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.timestamp.getTime(),
      event.sessionId,
      event.agentName,
      event.category,
      event.eventType,
      event.toolName ?? null,
      event.durationMs ?? null,
      event.success ? 1 : 0,
      event.errorType ?? null,
      event.tokenCount ?? null,
    ],
  )
}

const activeTimers = new Map<string, number>()

export function startTimer(key: string): void {
  activeTimers.set(key, Date.now())
}

export function endTimer(key: string): number {
  const start = activeTimers.get(key)
  if (start) {
    activeTimers.delete(key)
    return Date.now() - start
  }
  return 0
}

export function captureMetric(
  sessionId: string,
  agentName: string,
  category: string,
  eventType: AgentMetricEvent["eventType"],
  data: {
    toolName?: string
    durationMs?: number
    success?: boolean
    errorType?: string
    tokenCount?: number
  } = {},
): void {
  recordMetric({
    id: crypto.randomUUID(),
    timestamp: new Date(),
    sessionId,
    agentName,
    category,
    eventType,
    toolName: data.toolName,
    durationMs: data.durationMs,
    success: data.success ?? true,
    errorType: data.errorType,
    tokenCount: data.tokenCount,
  })
}

export function captureToolCall(
  sessionId: string,
  agentName: string,
  toolName: string,
  durationMs: number,
  success: boolean,
  errorType?: string,
): void {
  captureMetric(sessionId, agentName, "tool", "tool_call", {
    toolName,
    durationMs,
    success,
    errorType,
  })
}

export function captureDelegation(
  sessionId: string,
  agentName: string,
  delegatedTo: string,
  success: boolean,
): void {
  captureMetric(sessionId, agentName, "delegation", "delegation", {
    toolName: delegatedTo,
    success,
  })
}

export function captureSessionComplete(
  sessionId: string,
  agentName: string,
  durationMs: number,
  tokenCount: number,
  success: boolean,
): void {
  captureMetric(sessionId, agentName, "session", "session_complete", {
    durationMs,
    tokenCount,
    success,
  })
}
