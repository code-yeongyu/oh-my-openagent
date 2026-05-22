/**
 * Agent analytics collector - captures metrics from hooks
 */

import { randomUUID } from "node:crypto"
import type { AgentMetricEvent } from "./types"
import { recordMetric } from "./storage"

const activeTimers = new Map<string, number>()

export function startTimer(eventId: string): void {
  activeTimers.set(eventId, Date.now())
}

export function endTimer(eventId: string): number {
  const start = activeTimers.get(eventId)
  if (!start) return 0
  activeTimers.delete(eventId)
  return Date.now() - start
}

export function captureMetric(
  partial: Omit<AgentMetricEvent, "id" | "timestamp" | "durationMs"> & { durationMs?: number },
): void {
  const event: AgentMetricEvent = {
    id: randomUUID(),
    timestamp: new Date(),
    durationMs: partial.durationMs ?? 0,
    ...partial,
  }
  recordMetric(event)
}

export function captureToolCall(args: {
  sessionId: string
  agentName: string
  category: string
  toolName: string
  startTime: number
  success: boolean
  tokenCount?: number
  errorType?: string
}): void {
  const durationMs = Date.now() - args.startTime
  captureMetric({
    sessionId: args.sessionId,
    agentName: args.agentName,
    category: args.category,
    eventType: "tool_call",
    toolName: args.toolName,
    durationMs,
    success: args.success,
    tokenCount: args.tokenCount,
    errorType: args.errorType,
  })
}

export function captureDelegation(args: {
  sessionId: string
  agentName: string
  category: string
  targetAgent: string
  startTime: number
  success: boolean
}): void {
  const durationMs = Date.now() - args.startTime
  captureMetric({
    sessionId: args.sessionId,
    agentName: args.agentName,
    category: args.category,
    eventType: "delegation",
    toolName: args.targetAgent,
    durationMs,
    success: args.success,
  })
}

export function captureSessionComplete(args: {
  sessionId: string
  agentName: string
  category: string
  durationMs: number
  success: boolean
  tokenCount?: number
}): void {
  captureMetric({
    sessionId: args.sessionId,
    agentName: args.agentName,
    category: args.category,
    eventType: "session_complete",
    durationMs: args.durationMs,
    success: args.success,
    tokenCount: args.tokenCount,
  })
}