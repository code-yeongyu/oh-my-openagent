import { CostSummary, CostBudget, BudgetAlert } from "./types"
import {
  getTotalCostSince,
  getCostByAgent,
  getCostByModel,
  getBudgets as getStoredBudgets,
  insertBudget,
  insertAlert,
  getRecentAlerts,
} from "./storage"
import { formatCost } from "./pricing"

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function getTimeRangeMs(range: "1h" | "24h" | "7d" | "30d" | "all"): number {
  const now = Date.now()
  switch (range) {
    case "1h": return now - HOUR
    case "24h": return now - DAY
    case "7d": return now - WEEK
    case "30d": return now - 30 * DAY
    case "all": return 0
  }
}

export function getCostSummary(range: "1h" | "24h" | "7d" | "30d" | "all"): CostSummary {
  const since = getTimeRangeMs(range)
  const totalCostUsd = getTotalCostSince(since)
  const costByAgent = getCostByAgent(since)
  const costByModel = getCostByModel(since)

  return {
    totalCostUsd,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    costByAgent,
    costByModel,
    costByDay: {},
    topCostTools: [],
  }
}

export function checkBudgets(range: "1h" | "24h" | "7d" | "30d" | "all"): BudgetAlert[] {
  const budgets = getStoredBudgets().filter(b => b.enabled)
  const since = getTimeRangeMs(range)
  const currentSpend = getTotalCostSince(since)
  const alerts: BudgetAlert[] = []

  for (const budget of budgets) {
    const thresholdVal = (budget.limitUsd * budget.alertThreshold) / 100
    if (currentSpend >= thresholdVal) {
      const alert: BudgetAlert = {
        id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        thresholdUsd: thresholdVal,
        currentSpendUsd: currentSpend,
        exceeded: currentSpend >= budget.limitUsd,
        notified: false,
        createdAt: new Date(),
      }
      insertAlert(alert)
      alerts.push(alert)
    }
  }

  return alerts
}

export function setBudget(budget: CostBudget): void {
  insertBudget(budget)
}

export function formatCostReport(summary: CostSummary): string {
  const lines: string[] = []
  lines.push("Cost Report")
  lines.push("=".repeat(40))

  const costStr = summary.totalCostUsd < 0.01
    ? `$${(summary.totalCostUsd * 100).toFixed(2)}¢`
    : `$${summary.totalCostUsd.toFixed(4)}`
  lines.push(`Total: ${costStr}`)

  if (Object.keys(summary.costByAgent).length > 0) {
    lines.push("")
    lines.push("By Agent:")
    for (const [agent, cost] of Object.entries(summary.costByAgent).sort(([, a], [, b]) => b - a)) {
      lines.push(`  ${agent}: ${formatCost(cost)}`)
    }
  }

  if (Object.keys(summary.costByModel).length > 0) {
    lines.push("")
    lines.push("By Model:")
    for (const [model, cost] of Object.entries(summary.costByModel).sort(([, a], [, b]) => b - a)) {
      lines.push(`  ${model}: ${formatCost(cost)}`)
    }
  }

  return lines.join("\n")
}
