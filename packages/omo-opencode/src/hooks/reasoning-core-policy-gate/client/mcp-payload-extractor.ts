export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function extractJsonRpcError(response: unknown): string | undefined {
  if (!isRecord(response)) return "non-JSON response"
  if (!isRecord(response.error)) return undefined

  const code = typeof response.error.code === "number" ? response.error.code : undefined
  const message = typeof response.error.message === "string" ? response.error.message : "unknown error"
  return code == null ? message : `${code}: ${message}`
}

export function extractToolPayload(response: unknown): unknown {
  if (!isRecord(response)) return undefined
  if (!isRecord(response.result)) return undefined

  const result = response.result
  if (isRecord(result.structuredContent)) return result.structuredContent

  const content = result.content
  if (Array.isArray(content)) {
    const first = content[0]
    if (isRecord(first) && typeof first.text === "string") {
      return tryParseJson(first.text) ?? first.text
    }
  }

  return result
}
