function sortedStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value)

  const sorted = Object.keys(value as object)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (value as Record<string, unknown>)[key]
      return acc
    }, {})

  return JSON.stringify(sorted, (_, v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? Object.keys(v as object)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = (v as Record<string, unknown>)[key]
            return acc
          }, {})
      : v,
  )
}

export function computeTheoryHash(theory: unknown): string {
  if (theory === null || theory === undefined) return ""

  const serialized = sortedStringify(theory)
  return Bun.hash(serialized).toString(16)
}
