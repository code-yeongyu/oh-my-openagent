const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"])

function isUnsafeObjectKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.prototype.toString.call(value) === "[object Object]"
}

function sanitizeOmoConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeOmoConfigValue(entry))
  if (!isPlainObject(value)) return value

  const sanitized: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey(key)) continue
    sanitized[key] = sanitizeOmoConfigValue(entry)
  }
  return sanitized
}

function mergeCodegraphExcludedRoots(base: readonly unknown[], override: readonly unknown[]): unknown[] {
  return [...new Set([...base, ...override])]
}

export function mergeOmoConfigRecords(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
  parentKey?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(override)) {
    if (isUnsafeObjectKey(key)) continue
    const safeValue = sanitizeOmoConfigValue(value)
    const baseValue = result[key]
    result[key] = key === "excluded_roots" && parentKey === "codegraph" && Array.isArray(baseValue) && Array.isArray(safeValue)
      ? mergeCodegraphExcludedRoots(baseValue, safeValue)
      : isPlainObject(baseValue) && isPlainObject(safeValue)
        ? mergeOmoConfigRecords(baseValue, safeValue, key)
        : safeValue
  }

  return result
}
