export interface ModelPrice {
  inputPerMillionTokens: number
  outputPerMillionTokens: number
  currency: "USD"
  provider: string
}

export interface CostEntry {
  id: string
  sessionId: string
  agentName: string
  modelUsed: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  toolName: string
  category: string
  timestamp: Date
}

export interface BudgetAlert {
  id: string
  thresholdUsd: number
  currentSpendUsd: number
  exceeded: boolean
  sessionId?: string
  notified: boolean
  createdAt: Date
}

export interface CostSummary {
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  costByAgent: Record<string, number>
  costByModel: Record<string, number>
  costByDay: Record<string, number>
  topCostTools: Array<{ toolName: string; costUsd: number }>
}

export interface CostBudget {
  id: string
  name: string
  limitUsd: number
  period: "daily" | "weekly" | "monthly" | "session"
  currentSpendUsd: number
  alertThreshold: number // percentage 0-100
  enabled: boolean
}
