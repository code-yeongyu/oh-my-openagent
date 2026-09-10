import { duration } from "../format/units"
import { truncateVisible } from "../format/truncate"
import type { PanelChild, PanelChildStatus } from "../store"
import type { PanelRow } from "../types"
import { heading } from "./layout"

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
    rows.push({ text: truncateVisible(text, width), color: COLOR[child.status] })
  }
  return rows
}
