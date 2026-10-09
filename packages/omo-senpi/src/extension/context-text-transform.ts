type ContextTextTransform = (text: string, segment?: Record<string, unknown>) => string

// Keep producer-owned segment boundaries current when an earlier context hook changes text.
export function transformContextText(message: Record<string, unknown>, transform: ContextTextTransform): Record<string, unknown> {
  const content = message["content"]
  if (typeof content !== "string") return message
  const details = message["details"]
  if (message["customType"] !== "omo-senpi:wake" || !Array.isArray(details)) return { ...message, content: transform(content, message) }
  let cursor = 0
  let selected = ""
  const updated = details.map((detail: unknown) => {
    if (!isRecord(detail) || !Array.isArray(detail["contentRange"])) return detail
    const [start, end] = detail["contentRange"]
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < cursor || end < start || end > content.length) return detail
    selected += transform(content.slice(cursor, start))
    const selectedStart = selected.length
    selected += transform(content.slice(start, end), detail)
    cursor = end
    return { ...detail, contentRange: [selectedStart, selected.length] }
  })
  selected += transform(content.slice(cursor))
  return { ...message, content: selected, details: updated }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
