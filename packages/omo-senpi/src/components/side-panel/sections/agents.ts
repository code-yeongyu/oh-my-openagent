import { compactCost, compactTokens, duration } from "../format/units"
import { truncateVisible } from "../format/truncate"
import type { PanelChild, PanelChildStatus } from "../store"
import type { PanelRow } from "../types"
import { field, heading } from "./layout"

/** Status glyphs: shape carries the state, colour only reinforces it. */
const GLYPH: Record<PanelChildStatus, string> = {
  queued: "◦",
  running: "●",
  finished: "✓",
  failed: "✗",
  cancelled: "—",
}

const COLOR: Record<PanelChildStatus, PanelRow["color"]> = {
  queued: "dim",
  running: "text",
  finished: "muted",
  failed: "error",
  cancelled: "dim",
}

/**
 * Delegated children, newest last. A running child shows its live elapsed time and the
 * last thing it was seen doing; a finished one keeps the time it took.
 */
export function buildAgentRows(children: readonly PanelChild[], now: number, width: number): readonly PanelRow[] {
  if (width <= 0 || children.length === 0) return []
  const running = children.filter((child) => child.status === "running" || child.status === "queued").length
  const done = children.length - running
  const summary = running > 0 ? `${running} running · ${done} done` : `${done} done`
  const rows: PanelRow[] = [heading("AGENTS", summary)]
  for (const child of children) {
    const elapsed = duration((child.finishedAt ?? now) - child.startedAt)
    const head = `${GLYPH[child.status]} ${child.name}  ${elapsed}`
    const activity = child.status === "running" ? child.activity : undefined
    const text = activity === undefined ? head : `${head}  ${activity}`
    rows.push({
      text: truncateVisible(text, width),
      color: COLOR[child.status],
      action: { kind: "agent", id: child.id },
    })
  }
  return rows
}

/**
 * One child in full, for the viewer a click opens. The row in the column is a summary cut to a
 * narrow width; this is where the parts that did not fit go.
 */
export function buildAgentCardRows(child: PanelChild, now: number): readonly PanelRow[] {
  const rows: PanelRow[] = [
    field("status", `${GLYPH[child.status]} ${child.status}`, COLOR[child.status]),
    field("elapsed", duration((child.finishedAt ?? now) - child.startedAt)),
  ]
  if (child.category !== undefined) rows.push(field("category", child.category))
  if (child.activity !== undefined) rows.push(field("doing", child.activity, "muted"))
  if (child.turns !== undefined) rows.push(field("turns", String(child.turns), "muted"))
  if (child.tokens !== undefined) rows.push(field("tokens", compactTokens(child.tokens), "muted"))
  if (child.cost !== undefined) rows.push(field("cost", compactCost(child.cost), "muted"))
  rows.push(field("id", child.id, "dim"))
  return rows
}
