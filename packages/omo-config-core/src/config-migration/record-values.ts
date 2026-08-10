const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"])

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.prototype.toString.call(value) === "[object Object]"
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry))
  if (!isPlainRecord(value)) return value
  const copy: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) continue
    copy[key] = cloneValue(entry)
  }
  return copy
}

export function copyRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return cloneValue(value) as Record<string, unknown>
}

export function mergeRecords(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged = copyRecord(base)
  for (const [key, overrideValue] of Object.entries(override)) {
    if (UNSAFE_KEYS.has(key)) continue
    const baseValue = merged[key]
    merged[key] = isPlainRecord(baseValue) && isPlainRecord(overrideValue)
      ? mergeRecords(baseValue, overrideValue)
      : cloneValue(overrideValue)
  }
  return merged
}

export function withoutLegacyMetadata(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const copy = copyRecord(value)
  delete copy["$schema"]
  delete copy["_migrations"]
  delete copy.appliedMigrations
  return copy
}
