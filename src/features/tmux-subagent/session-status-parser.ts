type SessionStatus = { type: string }

export function parseSessionStatusMap(data: unknown): Record<string, SessionStatus> {
  if (typeof data !== "object" || data === null) return {}
  const record = data as Record<string, unknown>

  const result: Record<string, SessionStatus> = {}
  for (const [sessionId, value] of Object.entries(record)) {
    if (typeof value !== "object" || value === null) continue
    const valueRecord = value as Record<string, unknown>
    const type = valueRecord["type"]
    if (typeof type !== "string") continue
    result[sessionId] = { type }
  }

  return result
}
