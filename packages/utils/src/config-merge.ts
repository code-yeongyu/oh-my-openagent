export function mergeUniqueStrings<TValue extends string>(
  base: readonly TValue[] | undefined,
  override: readonly TValue[] | undefined,
): TValue[] {
  return [...new Set([...(base ?? []), ...(override ?? [])])]
}

export function mergeUniqueStringsCaseInsensitive<TValue extends string>(
  base: readonly TValue[] | undefined,
  override: readonly TValue[] | undefined,
): TValue[] {
  const seen = new Set<string>()
  const result: TValue[] = []

  for (const value of [...(base ?? []), ...(override ?? [])]) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }

  return result
}
