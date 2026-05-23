export interface SessionSnapshot {
  id: string
  sessionId: string
  sequence: number
  agentName: string
  eventType: "tool_call" | "tool_result" | "decision" | "state_change" | "error" | "message"
  toolName?: string
  input?: unknown
  output?: unknown
  decision?: string
  reasoning?: string
  durationMs?: number
  stateDiff?: Record<string, { before: unknown; after: unknown }>
  error?: string
  timestamp: Date
}

export interface ReplaySession {
  id: string
  snapshots: SessionSnapshot[]
  currentIndex: number
  totalSnapshots: number
}

export interface DecisionNode {
  id: string
  snapshotId: string
  agentName: string
  decision: string
  reasoning?: string
  children: DecisionNode[]
  parentId?: string
  durationMs?: number
  outcome?: "success" | "failure" | "pending"
}

export interface ReplayStep {
  snapshot: SessionSnapshot
  index: number
  total: number
  canGoBack: boolean
  canGoForward: boolean
  decisionTree?: DecisionNode
}

export interface ReplaySummary {
  sessionId: string
  totalSnapshots: number
  totalToolCalls: number
  totalDecisions: number
  totalErrors: number
  totalDurationMs: number
  agents: string[]
  tools: string[]
  errorRate: number
}

export interface SessionDiff {
  snapshotId: string
  sequence: number
  eventType: string
  changes: Array<{
    path: string
    before: unknown
    after: unknown
  }>
}
