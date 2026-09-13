/**
 * Wheel events for the panel's viewers.
 *
 * The host routes a wheel event to whatever scroll view sits under the pointer in its layout,
 * and an overlay is composited separately rather than being part of that layout - so a wheel
 * over an open viewer scrolls the transcript behind it instead. The viewer therefore reads the
 * wheel itself, through the raw-input listener the host offers extensions, and claims the event
 * so nothing scrolls underneath.
 *
 * Only SGR reports are decoded: the alt-screen renderer enables mode 1006, so that is what
 * terminals send.
 */

/** Rows a single wheel notch moves. Three is the usual terminal default and reads as one nudge. */
export const WHEEL_ROWS = 3

const SGR = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/

export interface PanelWheelEvent {
  /** -1 scrolls towards the top, 1 towards the bottom. */
  readonly direction: -1 | 1
  /**
   * False for the release form. Terminals report a notch as a press only, but a release is
   * still claimed rather than passed on, so a stray one cannot reach the surface below.
   */
  readonly press: boolean
}

export function parsePanelWheelEvent(data: string): PanelWheelEvent | undefined {
  const match = SGR.exec(data)
  if (match === null) return undefined
  const button = Number.parseInt(match[1] ?? "", 10)
  if (!Number.isFinite(button) || (button & 64) === 0) return undefined
  const direction = button & 3
  if (direction !== 0 && direction !== 1) return undefined
  return { direction: direction === 0 ? -1 : 1, press: match[4] === "M" }
}
