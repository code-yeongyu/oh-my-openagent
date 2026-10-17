import { createHash } from "node:crypto"
import { canonicalJson } from "./schema"
import type { Json } from "./types"

export const MEASUREMENT_MODES = ["fresh", "keep_alive", "keep_alive", "fresh"] as const
export type MeasurementMode = "fresh" | "keep_alive"
export type TokenSnapshot = {
  readonly total_tokens?: number
  readonly input_tokens?: number
  readonly output_tokens?: number
  readonly cache_read_tokens?: number
  readonly cache_write_tokens?: number
  readonly cost_usd?: number
  readonly token_status?: string
  readonly cost_status?: string
}
export type MeasurementRun = {
  readonly mode: MeasurementMode
  readonly provider: string
  readonly model: string
  readonly batch_sha256: string
  readonly prompt_sha256: string
  readonly caps_sha256: string
  readonly item_order_sha256: string
  readonly scored_items: number
  readonly correct_items: number
  readonly total_tokens: number
  readonly cost_usd: number
  readonly p95_ms: number
  readonly peak_residents: number
  readonly complete: boolean
}
export type MeasurementReport = {
  readonly schema_version: 1
  readonly plan_sha256: string
  readonly status: "conclusive" | "inconclusive"
  readonly design: "AB/BA"
  readonly width: 2
  readonly batch_sha256: string
  readonly source_sha256: string
  readonly item_count: 12
  readonly senpi_items: 6
  readonly omo_items: 6
  readonly token_coverage: boolean
  readonly budget_exhausted: boolean
  readonly duplicate_dispatches: number
  readonly uncertain_dispatches: number
  readonly runs: readonly MeasurementRun[]
}
export type BudgetCeiling = { readonly max_cost_usd: number | null; readonly max_total_tokens: number | null }

export function digestJson(value: Json): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}
export function epochDelta(before: TokenSnapshot | undefined, after: TokenSnapshot | undefined) {
  const covered = after?.token_status === "complete" && after.cost_status === "reported"
    && typeof after.total_tokens === "number" && typeof after.cost_usd === "number"
  if (!covered) return { tokens: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, covered: false }
  const sub = (a: number | undefined, b: number | undefined): number => (a ?? 0) - (b ?? 0)
  const tokens = sub(after.total_tokens, before?.total_tokens)
  const cost = sub(after.cost_usd, before?.cost_usd)
  if (!(tokens > 0) || cost < 0) return { tokens: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, covered: false }
  return {
    tokens, cost, covered: true,
    input: sub(after.input_tokens, before?.input_tokens),
    output: sub(after.output_tokens, before?.output_tokens),
    cacheRead: sub(after.cache_read_tokens, before?.cache_read_tokens),
    cacheWrite: sub(after.cache_write_tokens, before?.cache_write_tokens),
  }
}
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].toSorted((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? Number.NaN
}
export function budgetAllows(spent: { readonly cost: number; readonly tokens: number }, ceiling: BudgetCeiling): boolean {
  if (spent.cost < 0 || spent.tokens < 0) return false
  if (ceiling.max_cost_usd !== null && spent.cost >= ceiling.max_cost_usd) return false
  if (ceiling.max_total_tokens !== null && spent.tokens >= ceiling.max_total_tokens) return false
  return true
}
export function scoreYield(data: unknown, expected: unknown): boolean {
  return canonicalJson(JSON.parse(JSON.stringify(data)) as Json) === canonicalJson(JSON.parse(JSON.stringify(expected)) as Json)
}
export function recommendDefault(report: MeasurementReport): MeasurementMode {
  const fresh = report.runs.filter(run => run.mode === "fresh")
  const keep = report.runs.filter(run => run.mode === "keep_alive")
  const sum = (runs: readonly MeasurementRun[], pick: (run: MeasurementRun) => number): number => runs.reduce((total, run) => total + pick(run), 0)
  const max = (runs: readonly MeasurementRun[], pick: (run: MeasurementRun) => number): number => Math.max(...runs.map(pick))
  if (fresh.length !== 2 || keep.length !== 2) return "fresh"
  if (!fresh.every(run => run.complete && run.total_tokens > 0) || !keep.every(run => run.complete && run.total_tokens > 0)) return "fresh"
  if (sum(keep, run => run.correct_items) < sum(fresh, run => run.correct_items)) return "fresh"
  if (report.duplicate_dispatches !== 0 || report.uncertain_dispatches !== 0) return "fresh"
  if (max(keep, run => run.p95_ms) > max(fresh, run => run.p95_ms) * 1.10) return "fresh"
  if (sum(keep, run => run.cost_usd) > sum(fresh, run => run.cost_usd) * 0.90) return "fresh"
  return "keep_alive"
}
export function comparable(report: Omit<MeasurementReport, "status">): boolean {
  const first = report.runs[0]
  return report.design === "AB/BA" && report.width === 2 && report.item_count === 12 && report.senpi_items === 6 && report.omo_items === 6
    && report.token_coverage && !report.budget_exhausted && report.duplicate_dispatches === 0 && report.uncertain_dispatches === 0
    && report.runs.length === 4 && report.runs.map(run => run.mode).join(",") === MEASUREMENT_MODES.join(",")
    && first !== undefined && report.runs.every(run => run.provider === first.provider && run.model === first.model
      && run.batch_sha256 === report.batch_sha256 && run.prompt_sha256 === first.prompt_sha256 && run.caps_sha256 === first.caps_sha256
      && run.item_order_sha256 === first.item_order_sha256 && run.complete && run.scored_items === 12 && run.total_tokens > 0 && run.peak_residents <= 2)
}
export function finalizeReport(partial: Omit<MeasurementReport, "status">): MeasurementReport {
  return { ...partial, status: comparable(partial) ? "conclusive" : "inconclusive" }
}
