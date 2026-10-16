import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

export const MODEL_SLOTS = 3

export type SummaryTurn = {
  readonly turnIndex: number
  readonly provider: string
  readonly modelId: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly totalTokens: number
  readonly costUsd: number
  readonly usageValid: boolean
  readonly stopReason: string | undefined
  readonly toolResultCount: number
  readonly toolErrorCount: number
}

type NumericTurnField = { [K in keyof SummaryTurn]: SummaryTurn[K] extends number ? K : never }[keyof SummaryTurn]

// Each summed property and the turn field it adds up; the schema is derived from these tables.
const SUMMED: ReadonlyArray<readonly [string, NumericTurnField]> = [
  ["input_tokens", "inputTokens"],
  ["output_tokens", "outputTokens"],
  ["cache_read_tokens", "cacheReadTokens"],
  ["cache_write_tokens", "cacheWriteTokens"],
  ["reasoning_tokens", "reasoningTokens"],
  ["total_tokens", "totalTokens"],
  ["cost_usd", "costUsd"],
  ["tool_result_count", "toolResultCount"],
  ["tool_error_count", "toolErrorCount"],
]
const COUNTED: ReadonlyArray<readonly [string, (turn: SummaryTurn) => boolean]> = [
  ["invalid_usage_turns", (turn) => !turn.usageValid],
  ["error_turns", (turn) => turn.stopReason === "error"],
  ["aborted_turns", (turn) => turn.stopReason === "aborted"],
  ["custom_model_turns", (turn) => turn.modelId === "custom"],
]
const PER_MODEL: ReadonlyArray<readonly [string, NumericTurnField]> = [
  ["input_tokens", "inputTokens"],
  ["output_tokens", "outputTokens"],
  ["total_tokens", "totalTokens"],
  ["cost_usd", "costUsd"],
]

export const SUMMARY_NUMBER_KEYS: readonly string[] = [
  "summary_seq", "sample_rate", "turns", "first_turn_index", "last_turn_index", "window_ms",
  "total_tokens_p50", "total_tokens_p95", "total_tokens_max", "model_count",
  "other_turns", "other_total_tokens", "other_cost_usd",
  ...SUMMED.map(([key]) => key),
  ...COUNTED.map(([key]) => key),
]
export const MODEL_SLOT_NUMBER_KEYS: readonly string[] = ["turns", ...PER_MODEL.map(([key]) => key)]

export type ModelTotals = { provider: string; model: string; sums: Record<string, number> }

export type SummaryWindow = {
  startedAt: number
  lastAt: number
  firstTurnIndex: number
  lastTurnIndex: number
  sums: Record<string, number>
  totals: number[]
  models: ModelTotals[]
}

export const ENDED_BY = ["checkpoint", "shutdown", "reload", "recovered"] as const
export type EndedBy = (typeof ENDED_BY)[number]

export type SummaryMeta = {
  readonly endedBy: EndedBy
  readonly seq: number
  readonly sampleRate: number
  readonly sampled: boolean
  readonly sessionRole: string
}

export function openWindow(at: number, turnIndex: number): SummaryWindow {
  return { startedAt: at, lastAt: at, firstTurnIndex: turnIndex, lastTurnIndex: turnIndex, sums: {}, totals: [], models: [] }
}

const add = (sums: Record<string, number>, key: string, value: number): void => {
  sums[key] = (sums[key] ?? 0) + value
}

export function addTurn(window: SummaryWindow, turn: SummaryTurn, at: number): void {
  window.lastAt = at
  window.lastTurnIndex = turn.turnIndex
  window.totals.push(turn.totalTokens)
  for (const [key, field] of SUMMED) add(window.sums, key, turn[field])
  for (const [key, applies] of COUNTED) if (applies(turn)) add(window.sums, key, 1)
  let entry = window.models.find((model) => model.provider === turn.provider && model.model === turn.modelId)
  if (entry === undefined) {
    entry = { provider: turn.provider, model: turn.modelId, sums: {} }
    window.models.push(entry)
  }
  add(entry.sums, "turns", 1)
  for (const [key, field] of PER_MODEL) add(entry.sums, key, turn[field])
}

export function summaryProperties(sessionHash: string, window: SummaryWindow, meta: SummaryMeta): EventTelemetryProperties {
  const ranked = [...window.models].sort((left, right) =>
    (right.sums["turns"] ?? 0) - (left.sums["turns"] ?? 0) || (right.sums["total_tokens"] ?? 0) - (left.sums["total_tokens"] ?? 0))
  const rest = ranked.slice(MODEL_SLOTS)
  const restSum = (key: string) => rest.reduce((sum, model) => sum + (model.sums[key] ?? 0), 0)
  const properties: Record<string, string | number | boolean> = {
    $session_id: sessionHash,
    summary_seq: meta.seq,
    is_final: meta.endedBy === "shutdown",
    ended_by: meta.endedBy,
    session_role: meta.sessionRole,
    sample_rate: meta.sampleRate,
    raw_turns_sampled: meta.sampled,
    turns: window.totals.length,
    first_turn_index: window.firstTurnIndex,
    last_turn_index: window.lastTurnIndex,
    window_ms: window.lastAt - window.startedAt,
    total_tokens_p50: percentile(window.totals, 0.5),
    total_tokens_p95: percentile(window.totals, 0.95),
    total_tokens_max: Math.max(0, ...window.totals),
    model_count: window.models.length,
    other_turns: restSum("turns"),
    other_total_tokens: restSum("total_tokens"),
    other_cost_usd: roundCost(restSum("cost_usd")),
  }
  for (const [key] of [...SUMMED, ...COUNTED]) properties[key] = window.sums[key] ?? 0
  properties["cost_usd"] = roundCost(window.sums["cost_usd"] ?? 0)
  for (let slot = 1; slot <= MODEL_SLOTS; slot += 1) {
    const model = ranked[slot - 1]
    properties[`m${slot}_provider`] = model?.provider ?? "none"
    properties[`m${slot}_model`] = model?.model ?? "none"
    for (const key of MODEL_SLOT_NUMBER_KEYS) properties[`m${slot}_${key}`] = model?.sums[key] ?? 0
    properties[`m${slot}_cost_usd`] = roundCost(model?.sums["cost_usd"] ?? 0)
  }
  return properties
}

function roundCost(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}

export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.ceil(q * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0
}
