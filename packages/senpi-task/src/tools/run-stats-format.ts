import type { TaskRunStats } from "../state"
import { formatCacheHitPercent, formatCostUsd, formatSpend } from "../status-line"

export function formatRunDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

// Prose-style suffix for the task_output status row: ` · ran 2m 14s · $0.4213 (CH: 87%) · 118 tok/s`.
// Spend reads immediately before throughput so the money fact and the speed fact stay adjacent.
export function runStatsSuffix(stats: TaskRunStats | undefined): string {
  if (stats === undefined) return ""
  const parts = [`ran ${formatRunDuration(stats.runtime_ms)}`]
  const spend = formatSpend(stats)
  if (spend !== undefined) parts.push(spend)
  if (stats.tokens_per_second !== undefined) parts.push(`${stats.tokens_per_second} tok/s`)
  return parts.map((part) => ` · ${part}`).join("")
}

// Token-style fragments for the task result row: `ran:2m14s cost:$0.4213 ch:87% tps:118`.
export function runStatsResultTokens(stats: TaskRunStats | undefined): readonly string[] {
  if (stats === undefined) return []
  const duration = formatRunDuration(stats.runtime_ms).replaceAll(" ", "")
  const cost = formatCostUsd(stats.cost_usd)
  const cacheHit = formatCacheHitPercent(stats.cache_hit_rate)
  return [
    `ran:${duration}`,
    ...(cost === undefined ? [] : [`cost:${cost}`]),
    ...(cacheHit === undefined ? [] : [`ch:${cacheHit.slice(5, -1)}`]),
    ...(stats.tokens_per_second === undefined ? [] : [`tps:${stats.tokens_per_second}`]),
  ]
}
