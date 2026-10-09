import { MIN_TRANSCRIPT_COLUMNS, PANEL_MAX_COLUMNS, PANEL_MIN_COLUMNS } from "./constants"

/**
 * Resolve the configured width against the live terminal.
 *
 * A percentage follows the terminal, a number is taken as columns, and both are clamped
 * so the panel can neither shrink into unreadability nor starve the transcript. A
 * terminal width of zero means the renderer has not measured yet, so the configured
 * column count is used as-is.
 */
export function resolvePanelWidth(configured: number | string, terminalWidth: number): number {
  const requested = typeof configured === "number" ? configured : percentOf(configured, terminalWidth)
  const clamped = Math.min(Math.max(requested, PANEL_MIN_COLUMNS), PANEL_MAX_COLUMNS)
  if (terminalWidth <= 0) return clamped
  // Leave the transcript its floor: below that the layout's `visible` gate drops the panel.
  const affordable = terminalWidth - MIN_TRANSCRIPT_COLUMNS
  if (affordable < PANEL_MIN_COLUMNS) return PANEL_MIN_COLUMNS
  return Math.min(clamped, affordable)
}

function percentOf(configured: string, terminalWidth: number): number {
  const percent = Number.parseInt(configured, 10)
  if (!Number.isFinite(percent) || terminalWidth <= 0) return PANEL_MIN_COLUMNS
  return Math.floor((terminalWidth * percent) / 100)
}
