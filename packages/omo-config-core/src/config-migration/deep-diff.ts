import { copyRecord, isPlainRecord } from "./record-values"

function equalValues(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equalValues(value, right[index]))
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
    Object.hasOwn(right, key) && equalValues(left[key], right[key]))
}

export function deepDifference(
  base: Readonly<Record<string, unknown>>,
  profile: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const difference: Record<string, unknown> = {}
  for (const [key, profileValue] of Object.entries(profile)) {
    const baseValue = base[key]
    if (isPlainRecord(baseValue) && isPlainRecord(profileValue)) {
      const nested = deepDifference(baseValue, profileValue)
      if (Object.keys(nested).length > 0) difference[key] = nested
      continue
    }
    if (!equalValues(baseValue, profileValue)) {
      difference[key] = isPlainRecord(profileValue) ? copyRecord(profileValue) : profileValue
    }
  }
  return difference
}
