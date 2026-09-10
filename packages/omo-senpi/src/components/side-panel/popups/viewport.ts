/**
 * The popup's height budget.
 *
 * The host clamps an overlay by slicing lines off the END of what the component paints, so
 * painting one row more than the cap silently eats the closing border - and only on content
 * long enough to fill the viewport, which makes it look intermittent. The budget therefore
 * has exactly one owner: this function. The overlay itself is given no percentage cap.
 */

/** Top border, title, hint, bottom border. */
export const POPUP_CHROME_ROWS = 4

export interface PopupBudget {
  /** Rows the popup paints in total, borders included. */
  readonly total: number
  /** Rows left for content. */
  readonly body: number
}

export function popupBudget(terminalRows: number, ratio: number): PopupBudget {
  const rows = Number.isFinite(terminalRows) && terminalRows > 0 ? Math.floor(terminalRows) : 24
  const share = Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, 1) : 0.72
  const total = Math.max(POPUP_CHROME_ROWS + 1, Math.min(rows, Math.floor(rows * share)))
  return { total, body: total - POPUP_CHROME_ROWS }
}

/** Clamp a scroll offset to the last full screen of content. */
export function clampScroll(scroll: number, contentRows: number, bodyRows: number): number {
  const max = Math.max(0, contentRows - bodyRows)
  if (!Number.isFinite(scroll) || scroll < 0) return 0
  return Math.min(Math.floor(scroll), max)
}
