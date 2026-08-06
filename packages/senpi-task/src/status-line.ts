import { excerptRendererText, optionalRendererText } from "./renderer-text"
import type { ResolvedModelRecord, TaskRunStats } from "./state"

// One status row must survive next to a spinner, elapsed clock and the terminal edge, so the human
// label is bounded here rather than at each call site.
const IDENTITY_MAX_WIDTH = 48

export type TaskIdentityInput = {
  readonly taskId: string
  readonly name?: string
  readonly description?: string
  readonly taskSummary?: string
}

export type StatusTargetInput = {
  readonly category?: string
  readonly agentType?: string
  readonly resolvedModel?: ResolvedModelRecord
  // Raw model string used when no resolved model metadata exists (live/legacy tasks).
  readonly model?: string
  readonly fallbackCount?: number
}

export type StatusLineStats = Pick<TaskRunStats, "turns" | "tool_calls"> & {
  readonly runtime_ms?: number
  readonly tokens_per_second?: number
  readonly cost_usd?: number
  readonly cache_hit_rate_last?: number
  readonly cache_hit_rate_run?: number
}

export type StatusLineInput = {
  readonly identity: string
  readonly target?: string
  readonly stats?: StatusLineStats
  readonly verb?: string
}

// WHAT the task is, not which opaque handle it got: the delegated-work summary beats the
// description (human label), which beats the generated name; the task id is only the last-resort
// handle when none was supplied.
export function taskIdentityLabel(input: TaskIdentityInput): string {
  const label =
    optionalRendererText(input.taskSummary) ?? optionalRendererText(input.description) ?? optionalRendererText(input.name)
  return label === undefined ? excerptRendererText(input.taskId, IDENTITY_MAX_WIDTH) : excerptRendererText(label, IDENTITY_MAX_WIDTH)
}

// WHO it runs as: one routing identity, shared by category- and agent-routed tasks. Category wins
// when both are present (a record never carries both, but a defensive caller might).
export function formatTargetIdentity(input: Pick<StatusTargetInput, "category" | "agentType">): string | undefined {
  const category = optionalRendererText(input.category)
  if (category !== undefined) return `category:${category}`
  const agentType = optionalRendererText(input.agentType)
  if (agentType !== undefined) return `agent:${agentType}`
  return undefined
}

// WHO it runs as plus WHICH model it resolved to, in the single canonical grammar:
//   category:<name>(<provider>/<model>:<effort>) | agent:<name>(<provider>/<model>:<effort>)
// Agent and category targets share the exact same shape; without an identity the bare model token
// is the only useful signal left.
export function formatTargetWithModel(input: StatusTargetInput): string | undefined {
  const identity = formatTargetIdentity(input)
  const model = formatStatusModel(input.resolvedModel) ?? optionalRendererText(input.model)
  if (identity !== undefined) return model === undefined ? identity : `${identity}(${model})`
  if (model !== undefined) return `model:${model}`
  return undefined
}

// WHERE it runs: the routing target plus the model actually resolved for it.
export function formatStatusTarget(input: StatusTargetInput): string | undefined {
  const target = formatTargetWithModel(input)
  if (target === undefined) return undefined
  const fallback = input.fallbackCount === undefined || input.fallbackCount <= 0 ? undefined : `fallback:${input.fallbackCount}`
  return fallback === undefined ? target : `${target} · ${fallback}`
}

// The canonical grammar every live/status row shares:
//   <identity> · <target (model)> · turn N (M tools) · <verb> · $C · T tok/s
export function composeStatusLine(input: StatusLineInput): string {
  const tokens = [
    input.identity,
    input.target,
    input.stats === undefined ? undefined : `turn ${input.stats.turns}${toolCountSuffix(input.stats.tool_calls)}`,
    input.verb,
    input.stats === undefined ? undefined : formatLiveSpend(input.stats),
    input.stats?.tokens_per_second === undefined ? undefined : `${input.stats.tokens_per_second} tok/s`,
  ]
  return tokens.filter((token): token is string => typeof token === "string" && token.length > 0).join(" · ")
}

// Running task rows keep spend compact; cache-hit rate remains available in completed-run details.
export function formatLiveSpend(stats: Pick<TaskRunStats, "cost_usd">): string | undefined {
  return formatCostUsd(stats.cost_usd)
}

// Completed-run summaries pair spend with the cumulative whole-run cache-hit rate.
export function formatRunSpend(
  stats: Pick<TaskRunStats, "cost_usd" | "cache_hit_rate_run">,
): string | undefined {
  return formatSpendFacts(stats.cost_usd, stats.cache_hit_rate_run)
}

function formatSpendFacts(costUsd: number | undefined, cacheHitRate: number | undefined): string | undefined {
  const cost = formatCostUsd(costUsd)
  const cacheHit = formatCacheHitPercent(cacheHitRate)
  if (cost === undefined) return cacheHit
  return cacheHit === undefined ? cost : `${cost} ${cacheHit}`
}

export function formatCostUsd(costUsd: number | undefined): string | undefined {
  if (costUsd === undefined || !Number.isFinite(costUsd) || costUsd < 0) return undefined
  return `$${costUsd.toFixed(4)}`
}

export function formatCacheHitPercent(cacheHitRate: number | undefined): string | undefined {
  if (cacheHitRate === undefined || !Number.isFinite(cacheHitRate) || cacheHitRate < 0 || cacheHitRate > 1) {
    return undefined
  }
  return `(CH: ${Math.round(cacheHitRate * 100)}%)`
}

export function toolCountSuffix(toolCalls: number): string {
  if (toolCalls <= 0) return ""
  return ` (${toolCalls} ${toolCalls === 1 ? "tool" : "tools"})`
}

function formatStatusModel(resolved: ResolvedModelRecord | undefined): string | undefined {
  if (resolved === undefined) return undefined
  const provider = optionalRendererText(resolved.provider)
  const modelId = optionalRendererText(resolved.model_id)
  if (provider === undefined || modelId === undefined) return undefined
  const effort = optionalRendererText(resolved.reasoning) ?? optionalRendererText(resolved.reasoning_effort) ?? optionalRendererText(resolved.variant)
  return `${provider}/${modelId}${effort === undefined ? "" : `:${effort}`}`
}
