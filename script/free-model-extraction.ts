function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function extractFreeOpenCodeModelIds(raw: unknown): string[] {
  if (!isRecord(raw)) return []
  const opencode = raw.opencode
  if (!isRecord(opencode)) return []
  const models = opencode.models
  if (!isRecord(models)) return []

  const ids: string[] = []
  for (const [id, entry] of Object.entries(models)) {
    if (!isRecord(entry)) continue
    if (entry.status === "deprecated") continue
    const cost = entry.cost
    if (!isRecord(cost)) continue
    if (cost.input !== 0 || cost.output !== 0) continue
    ids.push(id)
  }
  return ids.sort()
}
