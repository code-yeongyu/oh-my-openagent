/**
 * Filled progress bars. A percentage is a number you have to read; a bar is a
 * quantity you can see at a glance, which is the whole point of a status column.
 */

const FULL = "\u2588"
const EMPTY = "\u2591"
/** Eighth-width blocks, so a bar 11 cells wide still resolves ~1% steps. */
const PARTIAL = ["", "\u258f", "\u258e", "\u258d", "\u258c", "\u258b", "\u258a", "\u2589"]
/** Marks a reference point inside the bar, such as where a rolling window should be by now. */
const MARKER = "\u250a"

export interface BarOptions {
  /** Reference point in the same 0..1 space; rendered as a thin marker inside the bar. */
  readonly marker?: number
}

/** Render `ratio` (0..1) as a `width`-cell bar. A non-zero ratio always shows at least a sliver. */
export function bar(ratio: number, width: number, options: BarOptions = {}): string {
  if (!Number.isFinite(width) || width <= 0) return ""
  const clamped = clamp(ratio)
  const exact = clamped * width
  const whole = Math.floor(exact)
  const eighths = Math.round((exact - whole) * 8)
  let cells: string[] = []
  if (eighths === 8) {
    cells = [...FULL.repeat(Math.min(whole + 1, width))]
  } else {
    cells = [...FULL.repeat(whole)]
    if (whole < width && eighths > 0) cells.push(PARTIAL[eighths] ?? "")
  }
  // A ratio that rounds to nothing would read as "idle" when it is not.
  if (cells.length === 0 && clamped > 0) cells = [PARTIAL[1] ?? FULL]
  while (cells.length < width) cells.push(EMPTY)
  const rendered = cells.slice(0, width)
  const marker = options.marker
  if (marker !== undefined && Number.isFinite(marker)) {
    const at = Math.min(width - 1, Math.floor(clamp(marker) * width))
    rendered[at] = MARKER
  }
  return rendered.join("")
}

function clamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value > 1 ? 1 : value
}
