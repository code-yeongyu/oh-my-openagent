import { isPlainObject, isUnsafeObjectKey } from "@oh-my-opencode/utils"

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

export function mergeOmoConfigRecords(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(override)) {
    if (isUnsafeObjectKey(key)) continue
    const safeValue = sanitizeOmoConfigValue(value)
    const baseValue = result[key]
    result[key] = isPlainObject(baseValue) && isPlainObject(safeValue)
      ? mergeOmoConfigRecords(baseValue, safeValue)
      : safeValue
  }

  return result
}
