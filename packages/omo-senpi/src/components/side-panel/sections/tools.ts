import { truncateVisible } from "../format/truncate"
import type { PanelToolCall } from "../store"
import type { PanelRow } from "../types"
import { heading } from "./layout"

/**
 * Recent tool activity for the current exchange. The list is newest last, so the eye
 * lands on the freshest row next to the editor, and it shows only the tail: the point is
 * "what is happening now", not an audit log.
 */
export function buildToolRows(tools: readonly PanelToolCall[], width: number, visible: number): readonly PanelRow[] {
  if (width <= 0 || tools.length === 0 || visible <= 0) return []
  const shown = tools.slice(Math.max(0, tools.length - visible))
  const hidden = tools.length - shown.length
  const summary = hidden > 0 ? `${tools.length} · +${hidden} earlier` : String(tools.length)
  const rows: PanelRow[] = [heading("TOOLS", summary)]
  for (const call of shown) {
    const text = call.detail === undefined || call.detail === "" ? call.name : `${call.name}  ${call.detail}`
    rows.push({ text: truncateVisible(text, width), color: "muted" })
  }
  return rows
}
