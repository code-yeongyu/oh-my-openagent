import { compactCost, compactTokens, duration } from "../format/units"
import type { PanelRow } from "../types"
import { field, heading } from "./layout"

/** What the session header needs; every field is optional because a fresh session knows little. */
export interface PanelSessionFacts {
  readonly model?: string
  readonly startedAt?: number
  readonly now: number
  readonly totals?: PanelSessionTotals
  /** Cost of finished children, which session totals do not include. */
  readonly childSpend: number
}

/** Mirrors senpi's `UsageTotals`. */
export interface PanelSessionTotals {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly cost: number
  /** Already a percentage, not a ratio: the host stores `(cacheRead / latestPromptTokens) * 100`. */
  readonly latestCacheHitRate?: number
}

/**
 * The session block: what is running, for how long, and what it has cost so far.
 * The total in the heading is the only place a total appears - repeating it inside the
 * block was the first thing that read as noise.
 */
export function buildSessionRows(facts: PanelSessionFacts, width: number): readonly PanelRow[] {
  if (width <= 0) return []
  // A heading with nothing under it is the "wall of empty labels" this column exists to avoid.
  const known = facts.model !== undefined || facts.startedAt !== undefined || facts.totals !== undefined
  if (!known && facts.childSpend === 0) return []
  const totals = facts.totals
  const spend = (totals?.cost ?? 0) + facts.childSpend
  const tokens = totals === undefined ? 0 : totals.input + totals.output
  // A session that has not spent or spoken yet reads better with no summary than with "$0 · 0".
  const summary = spend === 0 && tokens === 0 ? undefined : `${compactCost(spend)} · ${compactTokens(tokens)}`
  const rows: PanelRow[] = [heading("SESSION", summary)]
  if (facts.model !== undefined && facts.model !== "") rows.push(field("model", facts.model))
  if (facts.startedAt !== undefined) rows.push(field("elapsed", duration(facts.now - facts.startedAt), "muted"))
  if (totals !== undefined && tokens > 0) {
    rows.push(field("tokens", `in ${compactTokens(totals.input)} · out ${compactTokens(totals.output)}`, "muted"))
    const hitRate = totals.latestCacheHitRate
    if (hitRate !== undefined) rows.push(field("cache", `${Math.round(hitRate)}% hit`, "muted"))
  }
  // Children bill separately, so their spend is called out rather than folded in silently.
  if (facts.childSpend > 0) rows.push(field("agents", compactCost(facts.childSpend), "muted"))
  return rows
}
