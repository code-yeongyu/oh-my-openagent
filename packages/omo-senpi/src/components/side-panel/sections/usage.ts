import { bar } from "../format/bars"
import { duration } from "../format/units"
import type { PanelRow } from "../types"
import {
  USAGE_PROVIDER_KEYS,
  type PanelUsageEntry,
  type PanelUsageSnapshot,
  type PanelUsageWindow,
} from "../usage/types"
import { barWidth, field, heading } from "./layout"

/** Windows drawn per provider. Anthropic publishes three; a fourth is already more column than it is worth. */
const WINDOW_ROWS = 4

/** "100%" is the widest a percentage gets; padding to it keeps the numbers under each other. */
const PERCENT_WIDTH = 4

/**
 * Subscription usage: how much of each rolling window the serving account has spent.
 *
 * The bars carry a marker at the point an evenly paced burn would have reached by now, which
 * is what turns "62%" into "62% and it is only Tuesday". Everything on screen comes from the
 * cached entry it was fetched with, so a name never ends up sitting over another account's
 * numbers.
 */
export function buildUsageRows(usage: PanelUsageSnapshot, now: number, width: number): readonly PanelRow[] {
  if (width <= 0) return []
  const present = USAGE_PROVIDER_KEYS.filter((key) => usage[key] !== undefined)
  if (present.length === 0) return []

  // One tail for the whole section, so every bar is the same length and the percentages form a
  // column. Sizing each row on its own reset label made the right edge ragged.
  const resetWidth = present.reduce((widest, key) => {
    const labels = (usage[key]?.windows ?? []).map((window) => resetLabel(window.resetsAt, now)?.length ?? 0)
    return Math.max(widest, ...labels)
  }, 0)
  const tail = PERCENT_WIDTH + 1 + (resetWidth === 0 ? 0 : resetWidth + 2)

  const body: PanelRow[] = []
  let freshest: number | undefined
  for (const key of present) {
    const entry = usage[key]
    if (entry === undefined) continue
    const rows = providerRows(entry, now, { width, tail, resetWidth }, present.length > 1 ? key : undefined)
    if (rows.length === 0) continue
    body.push(...rows)
    if (entry.updatedAt !== undefined && (freshest === undefined || entry.updatedAt > freshest)) {
      freshest = entry.updatedAt
    }
  }
  if (body.length === 0) return []
  const age = freshest === undefined ? undefined : `${duration(now - freshest)} ago`
  return [heading("USAGE", age), ...body]
}

/** Shared geometry: one bar width for the section, one column for the reset labels. */
interface UsageLayout {
  readonly width: number
  readonly tail: number
  readonly resetWidth: number
}

function providerRows(
  entry: PanelUsageEntry,
  now: number,
  layout: UsageLayout,
  label: string | undefined,
): readonly PanelRow[] {
  const rows: PanelRow[] = []
  const windows = entry.windows ?? []
  // A provider that has never answered says so through its error row; one that answered and
  // then failed keeps its bars, so there is nothing to announce beyond the error itself.
  if (windows.length === 0 && entry.error === undefined) return rows
  if (label !== undefined) rows.push({ text: label, color: "muted" })
  for (const window of windows.slice(0, WINDOW_ROWS)) {
    rows.push(windowRow(window, now, layout))
  }
  if (entry.error !== undefined) {
    const retry = entry.retryAt === undefined ? "" : ` · retry ${resetLabel(entry.retryAt, now) ?? "soon"}`
    rows.push({ text: `${entry.error}${retry}`, color: windows.length > 0 ? "dim" : "warning" })
  }
  const account = accountRow(entry)
  if (account !== undefined) rows.push(account)
  return rows
}

function windowRow(window: PanelUsageWindow, now: number, layout: UsageLayout): PanelRow {
  const percent = `${Math.round(window.percent)}%`.padStart(PERCENT_WIDTH)
  const reset = resetLabel(window.resetsAt, now)
  const rendered = bar(window.percent / 100, barWidth(layout.width, layout.tail), { ...paceMarker(window, now) })
  const trailing = layout.resetWidth === 0 ? "" : `  ${(reset ?? "").padEnd(layout.resetWidth)}`
  const value = `${rendered} ${percent}${trailing}`.trimEnd()
  return field(window.label, value, window.percent >= 90 ? "warning" : "accent")
}

/**
 * Where a perfectly even burn would be right now, in the same 0..1 space as the bar. Bars
 * ahead of their marker are the ones worth noticing.
 */
function paceMarker(window: PanelUsageWindow, now: number): { marker?: number } {
  const { windowMs, resetsAt } = window
  if (windowMs === undefined || resetsAt === undefined || windowMs <= 0) return {}
  const remaining = resetsAt - now
  if (remaining <= 0 || remaining > windowMs) return {}
  return { marker: 1 - remaining / windowMs }
}

/** Whose quota is on screen, and whether it is the account the user actually pinned. */
function accountRow(entry: PanelUsageEntry): PanelRow | undefined {
  const account = entry.account
  if (account === undefined) return undefined
  if (entry.accountState !== undefined && entry.accountState !== "ok") {
    return { text: `account ${account} (${entry.accountState})`, color: "warning" }
  }
  if (entry.pinnedAccount !== undefined && entry.pinnedAccount !== account) {
    return { text: `account ${account} (failover from ${entry.pinnedAccount})`, color: "warning" }
  }
  return { text: `account ${account}`, color: "dim" }
}

/** A countdown for windows that roll today, a weekday clock for the ones that do not. */
function resetLabel(at: number | undefined, now: number): string | undefined {
  if (at === undefined || !Number.isFinite(at)) return undefined
  const delta = at - now
  if (delta <= 0) return "now"
  if (delta < 24 * 60 * 60 * 1_000) {
    const minutes = Math.round(delta / 60_000)
    if (minutes < 60) return `${minutes}m`
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`
  }
  const date = new Date(at)
  const day = date.toLocaleDateString("en-US", { weekday: "short" })
  return `${day} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}
