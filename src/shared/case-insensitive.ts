/**
 * Finds a value in a record by key case-insensitively.
 * Returns undefined if no matching key is found.
 */
export function findCaseInsensitive<T>(
  record: Record<string, T>,
  key: string
): T | undefined {
  const lowerKey = key.toLowerCase()
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lowerKey) {
      return v
    }
  }
  return undefined
}
