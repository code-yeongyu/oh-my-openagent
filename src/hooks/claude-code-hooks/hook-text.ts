export function normalizeHookText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeHookTextList(values: readonly (string | undefined)[]): string[] {
  const normalizedValues: string[] = []
  for (const value of values) {
    const normalized = normalizeHookText(value)
    if (normalized !== undefined) {
      normalizedValues.push(normalized)
    }
  }
  return normalizedValues
}
