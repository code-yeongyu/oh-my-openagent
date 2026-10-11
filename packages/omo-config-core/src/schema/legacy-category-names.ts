/**
 * Retired builtin category keys and the canonical key that replaced them.
 *
 * `deep` was split into `deep-low` (default lane) and `deep-high` (escalation lane) in 2026-09.
 * A config written against the old name keeps working: the key is canonicalized to `deep-low` when
 * the config is loaded, and the startup migration rewrites the file itself.
 */
export const LEGACY_CATEGORY_NAME_ALIASES: Readonly<Record<string, string>> = { deep: "deep-low" }

export type LegacyCategoryRename = {
  readonly canonical: string
  readonly dropped: boolean
  readonly legacy: string
  readonly path: string
}

export type CanonicalizeLegacyCategoryNamesResult = {
  readonly document: Record<string, unknown>
  readonly renames: readonly LegacyCategoryRename[]
}

export function canonicalCategoryName(name: string): string {
  return Object.hasOwn(LEGACY_CATEGORY_NAME_ALIASES, name) ? LEGACY_CATEGORY_NAME_ALIASES[name] : name
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function joinPath(path: readonly string[], segment: string): string {
  return [...path, segment].join(".")
}

// A `categories` record is keyed by category name; every other `category` property in the config
// schema (team members, memory reflection) holds one as a string VALUE. Both spellings are rewritten.
function canonicalizeCategoriesRecord(
  categories: Record<string, unknown>,
  path: readonly string[],
  renames: LegacyCategoryRename[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(categories)) {
    const canonical = canonicalCategoryName(name)
    if (canonical === name) {
      result[name] = definition
      continue
    }
    const dropped = Object.hasOwn(categories, canonical)
    renames.push({ canonical, dropped, legacy: name, path: joinPath(path, name) })
    if (!dropped) result[canonical] = definition
  }
  return result
}

function canonicalizeValue(value: unknown, path: readonly string[], renames: LegacyCategoryRename[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalizeValue(entry, [...path, String(index)], renames))
  }
  if (!isRecord(value)) return value

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === "categories" && isRecord(entry)) {
      result[key] = canonicalizeCategoriesRecord(entry, [...path, key], renames)
      continue
    }
    if (key === "category" && typeof entry === "string") {
      const canonical = canonicalCategoryName(entry)
      if (canonical !== entry) {
        renames.push({ canonical, dropped: false, legacy: entry, path: joinPath(path, key) })
      }
      result[key] = canonical
      continue
    }
    result[key] = canonicalizeValue(entry, [...path, key], renames)
  }
  return result
}

export function canonicalizeLegacyCategoryNames(document: unknown): CanonicalizeLegacyCategoryNamesResult {
  const renames: LegacyCategoryRename[] = []
  const canonicalized = isRecord(document) ? canonicalizeValue(document, [], renames) : {}
  return { document: canonicalized as Record<string, unknown>, renames }
}

export function hasLegacyCategoryNames(document: unknown): boolean {
  return canonicalizeLegacyCategoryNames(document).renames.length > 0
}
