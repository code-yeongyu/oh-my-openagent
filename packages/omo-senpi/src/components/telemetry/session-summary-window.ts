import { randomBytes } from "node:crypto"
import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import { KNOWN_MODELS } from "./model-vocabulary"

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
  /** Cost in integer units of 1e-4 USD; the turn handler rounds once, everything downstream adds integers. */
  readonly cost1e4: number
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
  ["cost_1e4", "cost1e4"],
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
  ["cost_1e4", "cost1e4"],
]

export const SUMMARY_NUMBER_KEYS: readonly string[] = [
  "summary_seq", "sample_rate", "turns", "first_turn_index", "last_turn_index", "window_ms",
  "total_tokens_p50", "total_tokens_p95", "total_tokens_max", "model_count",
  "other_turns", "other_total_tokens", "other_cost_usd", "cost_usd", "dropped_events",
  ...SUMMED.map(([key]) => key),
  ...COUNTED.map(([key]) => key),
]
// Per-model slots publish cost in USD only; their integer sums stay internal.
export const MODEL_SLOT_NUMBER_KEYS: readonly string[] = ["turns", "input_tokens", "output_tokens", "total_tokens", "cost_usd"]

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
  readonly epoch: string
  readonly seq: number
  readonly sampleRate: number
  readonly sampled: boolean
  readonly sessionRole: string
  readonly droppedEvents: number
}

/**
 * A run of one session's numbering: random per process (and per opt-in), kept while that process continues the
 * same window file and replaced whenever another process continues or recovers it. The collector deduplicates on (session, summary_epoch, summary_seq), so two processes never
 * need to coordinate seqs and nothing has to survive an opt-out.
 */
export function newSummaryEpoch(): string {
  return randomBytes(8).toString("hex")
}

export const SUMMARY_EPOCH_SHAPE = /^[0-9a-f]{16}$/

export function openWindow(at: number, turnIndex: number): SummaryWindow {
  return { startedAt: at, lastAt: at, firstTurnIndex: turnIndex, lastTurnIndex: turnIndex, sums: {}, totals: [], models: [] }
}

const isFiniteNumber = (value: unknown): boolean => Number.isFinite(value)
const isSums = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(isFiniteNumber)

// A window read back from disk is untrusted: an older build, a torn copy or a hand edit must be rejected
// rather than summed into a row that claims exact totals.
export function isSummaryWindow(value: unknown): value is SummaryWindow {
  if (typeof value !== "object" || value === null) return false
  if (!["startedAt", "lastAt", "firstTurnIndex", "lastTurnIndex"].every((key) => isFiniteNumber(Reflect.get(value, key)))) return false
  const totals: unknown = Reflect.get(value, "totals")
  const models: unknown = Reflect.get(value, "models")
  return isSums(Reflect.get(value, "sums")) && Array.isArray(totals) && totals.every(isFiniteNumber)
    && Array.isArray(models) && models.every((model: unknown) => typeof model === "object" && model !== null
      && typeof Reflect.get(model, "provider") === "string" && typeof Reflect.get(model, "model") === "string"
      && isSums(Reflect.get(model, "sums")))
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
    summary_epoch: meta.epoch,
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
    other_cost_usd: usdOf(restSum("cost_1e4")),
    dropped_events: meta.droppedEvents,
  }
  for (const [key] of [...SUMMED, ...COUNTED]) properties[key] = window.sums[key] ?? 0
  properties["cost_usd"] = usdOf(window.sums["cost_1e4"] ?? 0)
  for (let slot = 1; slot <= MODEL_SLOTS; slot += 1) {
    const model = ranked[slot - 1]
    // A window recovered from disk may predate a vocabulary change, so the provider is re-masked here, not trusted.
    properties[`m${slot}_provider`] = model === undefined ? "none" : (Object.hasOwn(KNOWN_MODELS, model.provider) ? model.provider : "custom")
    properties[`m${slot}_model`] = model?.model ?? "none"
    for (const key of MODEL_SLOT_NUMBER_KEYS) properties[`m${slot}_${key}`] = model?.sums[key] ?? 0
    properties[`m${slot}_cost_usd`] = usdOf(model?.sums["cost_1e4"] ?? 0)
  }
  return properties
}

export function usdOf(cost1e4: number): number {
  return cost1e4 / 10_000
}

export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.ceil(q * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0
}
