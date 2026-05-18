/**
 * Format a duration between two Date objects or from a start Date to now.
 * Returns "Xh Ym Zs" format.
 */
export function formatDuration(start: Date, end?: Date): string {
  const ms = (end ?? new Date()).getTime() - start.getTime()
  return formatDurationMs(ms)
}

/**
 * Format a duration from milliseconds.
 * Returns "Xh Ym Zs" format.
 */
export function formatDurationMs(ms: number): string {
  if (ms < 0) ms = 0
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(" ")
}

/** @deprecated Use formatDurationMs instead */
export const formatDurationHuman = formatDurationMs
