/**
 * Case-insensitive lookup and comparison utilities for agent/config names.
 * Used throughout the codebase to allow "Oracle", "oracle", "ORACLE" to work the same.
 */

/**
 * Find a value in an object using case-insensitive key matching.
 * First tries exact match, then falls back to lowercase comparison.
 */
export function findCaseInsensitive<T>(obj: Record<string, T> | undefined, key: string): T | undefined {
  if (!obj) return undefined
  const exactMatch = obj[key]
  if (exactMatch !== undefined) return exactMatch
  const lowerKey = key.toLowerCase()
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === lowerKey) return v
  }
  return undefined
}

/**
 * Check if an array includes a value using case-insensitive comparison.
 */
export function includesCaseInsensitive(arr: string[], value: string): boolean {
  const lowerValue = value.toLowerCase()
  return arr.some((item) => item.toLowerCase() === lowerValue)
}

/**
 * Find an element in array using case-insensitive name matching.
 * Useful for finding agents/categories by name.
 */
export function findByNameCaseInsensitive<T extends { name: string }>(
  arr: T[],
  name: string
): T | undefined {
  const lowerName = name.toLowerCase()
  return arr.find((item) => item.name.toLowerCase() === lowerName)
}

/**
 * Check if two strings are equal (case-insensitive).
 */
export function equalsIgnoreCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
