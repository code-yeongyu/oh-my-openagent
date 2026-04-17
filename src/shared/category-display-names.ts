/**
 * Category display name resolution with config overrides.
 * Config overrides take priority over the category key itself.
 */

let categoryDisplayNameOverrides: Record<string, string> = {}

export function setCategoryDisplayNameOverrides(overrides: Record<string, string>): void {
  categoryDisplayNameOverrides = overrides
}

/**
 * Get display name for a category key.
 * Checks config overrides first, falls back to the category key as-is.
 */
export function getCategoryDisplayName(categoryKey: string): string {
  return categoryDisplayNameOverrides[categoryKey] ?? categoryKey
}

/**
 * Reverse lookup: find the category config key from a display name.
 * Searches overrides first, then falls back to the display name itself
 * (since most categories use their key as the default display name).
 */
export function getCategoryConfigKey(displayName: string): string {
  const normalized = displayName.trim().toLowerCase()
  for (const [key, name] of Object.entries(categoryDisplayNameOverrides)) {
    if (name.toLowerCase() === normalized) return key
  }
  return normalized
}
