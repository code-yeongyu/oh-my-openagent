import { bar } from "../format/bars"
import { compactTokens } from "../format/units"
import type { PanelRow } from "../types"
import { barWidth, field, heading } from "./layout"

/** Mirrors senpi's `ContextUsage`: tokens are null until the first response lands. */
export interface PanelContextUsage {
  readonly tokens: number | null
  readonly contextWindow: number
  readonly percent: number | null
}

/** How much of the context window is gone, as a bar you can read at a glance. */
export function buildContextRows(usage: PanelContextUsage | undefined, width: number): readonly PanelRow[] {
  if (width <= 0 || usage === undefined) return []
  const tokens = usage.tokens
  if (tokens === null) return [heading("CONTEXT"), field("window", "measuring", "dim")]
  const window = usage.contextWindow > 0 ? usage.contextWindow : undefined
  const summary = window === undefined
    ? compactTokens(tokens)
    : `${compactTokens(tokens)}/${compactTokens(window)}`
  const rows: PanelRow[] = [heading("CONTEXT", summary)]
  if (window === undefined) return rows
  const percent = usage.percent ?? (tokens / window) * 100
  const tail = 5
  const rendered = bar(percent / 100, barWidth(width, tail))
  if (rendered !== "") rows.push(field("used", `${rendered} ${Math.round(percent)}%`, "accent"))
  return rows
}
