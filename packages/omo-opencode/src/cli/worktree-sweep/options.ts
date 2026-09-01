/** Parses the `--older-than <days>` value: a non-negative integer, else throws. */
export function parseOlderThanDays(value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`--older-than must be a non-negative integer number of days, got: ${value}`)
  }
  return parsed
}
