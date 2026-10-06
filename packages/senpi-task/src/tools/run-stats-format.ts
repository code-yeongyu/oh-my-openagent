import type { TaskRunStats } from "../state"
import { formatRunSpend } from "../status-line"

export function formatRunDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

// Prose-style suffix for the task_output status row:
// ` · ran 2m 14s · 5 tools · $0.4213 (CH: 87%) · 118 tok/s`.
// Spend reads immediately before throughput so the money fact and the speed fact stay adjacent.
export function runStatsSuffix(stats: TaskRunStats | undefined): string {
  if (stats === undefined) return ""
  const parts = [`ran ${formatRunDuration(stats.runtime_ms)}`, `${stats.tool_calls} ${stats.tool_calls === 1 ? "tool" : "tools"}`]
  const spend = formatRunSpend(stats)
  if (spend !== undefined) parts.push(spend)
  if (stats.tokens_per_second !== undefined) parts.push(`${stats.tokens_per_second} tok/s`)
  return parts.map((part) => ` · ${part}`).join("")
}

// Prose summary for the completed-task card: ` · ran 2m 14s · 5 tools · $0.4213 (CH: 87%)`.
// Same grammar as runStatsSuffix but without throughput: a result card reads as a result, not a debug row.
export function runStatsCardSummary(stats: TaskRunStats | undefined): string {
  if (stats === undefined) return ""
  const parts = [`ran ${formatRunDuration(stats.runtime_ms)}`, `${stats.tool_calls} ${stats.tool_calls === 1 ? "tool" : "tools"}`]
  const spend = stats.cost_usd === 0 ? undefined : formatRunSpend(stats)
  if (spend !== undefined) parts.push(spend)
  return parts.map((part) => ` · ${part}`).join("")
}
