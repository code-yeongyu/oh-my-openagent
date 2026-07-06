import { isPlainObject, isUnsafeObjectKey } from "@oh-my-opencode/utils"

export function mergeOmoConfigRecords(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(override)) {
    if (isUnsafeObjectKey(key)) continue
    const baseValue = result[key]
    result[key] = isPlainObject(baseValue) && isPlainObject(value)
      ? mergeOmoConfigRecords(baseValue, value)
      : value
  }

  return result
}
