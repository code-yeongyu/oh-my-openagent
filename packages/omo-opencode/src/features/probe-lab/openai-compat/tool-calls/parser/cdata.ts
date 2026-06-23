const CDATA_OPEN = "<![CDATA["
const CDATA_CLOSE = "]]>"

export function parseCdataValue(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text
  const trimmed = text.trim()
  if (!trimmed.startsWith(CDATA_OPEN)) return trimmed
  const segments: string[] = []
  let cursor = 0
  while (cursor < trimmed.length) {
    if (!trimmed.startsWith(CDATA_OPEN, cursor)) break
    const innerStart = cursor + CDATA_OPEN.length
    const innerEnd = trimmed.indexOf(CDATA_CLOSE, innerStart)
    if (innerEnd === -1) {
      segments.push(trimmed.slice(innerStart))
      cursor = trimmed.length
      break
    }
    segments.push(trimmed.slice(innerStart, innerEnd))
    cursor = innerEnd + CDATA_CLOSE.length
    if (!trimmed.startsWith(CDATA_OPEN, cursor)) break
  }
  return segments.join("")
}
