import { SessionSnapshot, DecisionNode } from "./types"
import { insertSnapshot, insertDecisionNode } from "./storage"

let sequenceCounters = new Map<string, number>()

function getNextSequence(sessionId: string): number {
  const next = (sequenceCounters.get(sessionId) ?? 0) + 1
  sequenceCounters.set(sessionId, next)
  return next
}

export function resetSequence(sessionId: string): void {
  sequenceCounters.set(sessionId, 0)
}

export function captureSnapshot(params: {
  sessionId: string
  agentName: string
  eventType: SessionSnapshot["eventType"]
  toolName?: string
  input?: unknown
  output?: unknown
  decision?: string
  reasoning?: string
  durationMs?: number
  stateDiff?: Record<string, { before: unknown; after: unknown }>
  error?: string
}): SessionSnapshot {
  const snapshot: SessionSnapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: params.sessionId,
    sequence: getNextSequence(params.sessionId),
    agentName: params.agentName,
    eventType: params.eventType,
    toolName: params.toolName,
    input: params.input,
    output: params.output,
    decision: params.decision,
    reasoning: params.reasoning,
    durationMs: params.durationMs,
    stateDiff: params.stateDiff,
    error: params.error,
    timestamp: new Date(),
  }

  insertSnapshot(snapshot)
  return snapshot
}

export function captureDecision(params: {
  sessionId: string
  snapshotId: string
  agentName: string
  decision: string
  reasoning?: string
  parentId?: string
  durationMs?: number
  outcome?: DecisionNode["outcome"]
}): DecisionNode {
  const node: DecisionNode = {
    id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    snapshotId: params.snapshotId,
    agentName: params.agentName,
    decision: params.decision,
    reasoning: params.reasoning,
    children: [],
    parentId: params.parentId,
    durationMs: params.durationMs,
    outcome: params.outcome ?? "pending",
  }

  insertDecisionNode(node)
  return node
}
