/** Compact number and duration formatting for a column that is ~50 characters wide. */

/** `1234` -> `1.2K`, `1234567` -> `1.2M`. Keeps one decimal only where it adds information. */
export function compactTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0"
  const rounded = Math.round(value)
  if (rounded < 1_000) return String(rounded)
  // Promote at the rounded boundary: 999,999 reads as 1M, never as 1000K.
  const thousands = trim(rounded / 1_000)
  if (Number.parseFloat(thousands) < 1_000) return `${thousands}K`
  return `${trim(rounded / 1_000_000)}M`
}

/** `2048` -> `2.0KB`. Binary units, because these are file sizes. */
export function compactBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0B"
  const rounded = Math.round(value)
  if (rounded < 1024) return `${rounded}B`
  const kilobytes = trim(rounded / 1024)
  if (Number.parseFloat(kilobytes) < 1024) return `${kilobytes}KB`
  return `${trim(rounded / (1024 * 1024))}MB`
}

/** Elapsed time as `12s`, `4m30`, `2h05`. Fixed width per magnitude so rows stay aligned. */
export function duration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "0s"
  const totalSeconds = Math.floor(milliseconds / 1_000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, "0")}`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, "0")}`
}

/** Money with the precision the number deserves: cents below ten dollars, whole dollars above. */
export function compactCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0"
  if (value < 10) return `$${value.toFixed(2)}`
  if (value < 1_000) return `$${value.toFixed(1)}`
  return `$${Math.round(value)}`
}

function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}
