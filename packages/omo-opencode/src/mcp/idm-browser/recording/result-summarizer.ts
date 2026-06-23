type McpToolResult = {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
}

export function extractSessionId(result: unknown, params: Record<string, unknown>): string | undefined {
  const fromParams = typeof params.sessionId === "string" ? params.sessionId : undefined
  if (fromParams) return fromParams

  const r = result as McpToolResult | undefined
  const text = r?.content?.[0]?.text
  if (typeof text !== "string") return undefined
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed.sessionId === "string") return parsed.sessionId
  } catch {
    void 0
  }
  return undefined
}

export function summarizeResult(result: unknown): unknown {
  const r = result as McpToolResult | undefined
  if (!r?.content) return undefined

  const summary = r.content.map((part) => {
    if (part.type === "image") {
      const size = part.data ? part.data.length : 0
      return { type: "image", mimeType: part.mimeType, base64Bytes: size, omitted: true }
    }
    if (part.type === "text" && typeof part.text === "string") {
      if (part.text.length > 500) {
        return { type: "text", text: part.text.slice(0, 500), truncated: true, originalLength: part.text.length }
      }
      try {
        return { type: "text", parsed: JSON.parse(part.text) }
      } catch {
        return { type: "text", text: part.text }
      }
    }
    return part
  })

  return r.isError ? { isError: true, content: summary } : summary
}
