import type { PanelRow } from "../types"

/**
 * A delegated child's own work, as the viewer shows it.
 *
 * The task engine already renders its transcript to text for `task_output`, so the panel reuses
 * that rather than re-deriving what a child said: one format, one cap, one source of truth. This
 * half is pure - it only decides how the finished text is laid out and coloured.
 */

/** Said by the engine when a child left no transcript behind. */
export const NO_OUTPUT_NOTICE = "(no transcript recorded for this task)"

export function childOutputRows(text: string, truncated: boolean): readonly PanelRow[] {
  const body = text === "" ? [NO_OUTPUT_NOTICE] : text.split("\n")
  const rows: PanelRow[] = body.map((line) => ({ text: line, color: colorFor(line) }))
  if (truncated) {
    // The engine caps what it reads; saying so beats letting the tail look like the end.
    rows.push({ text: "(earlier output elided by the task engine's transcript cap)", color: "dim" })
  }
  return rows
}

/**
 * Colour follows the line's own prefix, so a wrapped assistant paragraph keeps reading as prose
 * instead of being repainted per line.
 */
function colorFor(line: string): PanelRow["color"] {
  if (line.startsWith("error") || line.startsWith("tool[error]")) return "error"
  if (line.startsWith("tool")) return "muted"
  if (line === NO_OUTPUT_NOTICE) return "dim"
  return "text"
}
