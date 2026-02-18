export function isTerminalFinishValue(finish: unknown): boolean {
  if (typeof finish === "boolean") {
    return finish
  }

  if (typeof finish === "string") {
    const normalized = finish.toLowerCase()
    return normalized !== "" && normalized !== "tool-calls" && normalized !== "unknown"
  }

  if (typeof finish === "object" && finish !== null) {
    const record = finish as Record<string, unknown>
    const kind = record.type ?? record.reason
    if (typeof kind === "string") {
      const normalized = kind.toLowerCase()
      return normalized !== "" && normalized !== "tool-calls" && normalized !== "unknown"
    }
  }

  return false
}

export function isTerminalStepFinishPart(part: unknown): boolean {
  if (typeof part !== "object" || part === null) {
    return false
  }

  const record = part as Record<string, unknown>
  if (record.type !== "step-finish") {
    return false
  }

  return isTerminalFinishValue(record.reason)
}

export function extractTextPartsFromMessageResponse(response: unknown): string {
  if (typeof response !== "object" || response === null) return ""
  const data = (response as Record<string, unknown>).data
  if (typeof data !== "object" || data === null) return ""
  const parts = (data as Record<string, unknown>).parts
  if (!Array.isArray(parts)) return ""

  return parts
    .map((part) => {
      if (typeof part !== "object" || part === null) return ""
      const partRecord = part as Record<string, unknown>
      if (partRecord.type !== "text") return ""
      return typeof partRecord.text === "string" ? partRecord.text : ""
    })
    .filter((text) => text.length > 0)
    .join("\n")
}

export function detectFallbackHandoffTarget(messageText: string): "atlas" | "prometheus" | undefined {
  if (!messageText) return undefined

  const normalized = messageText.toLowerCase()

  if (/switching\s+to\s+\*{0,2}\s*prometheus\b/.test(normalized) || /handing\s+off\s+to\s+\*{0,2}\s*prometheus\b/.test(normalized)) {
    return "prometheus"
  }

  if (/switching\s+to\s+\*{0,2}\s*atlas\b/.test(normalized) || /handing\s+off\s+to\s+\*{0,2}\s*atlas\b/.test(normalized)) {
    return "atlas"
  }

  return undefined
}

export function buildFallbackContext(target: "atlas" | "prometheus"): string {
  if (target === "prometheus") {
    return "Athena indicated handoff to Prometheus. Continue from the current session context and produce the requested phased plan based on the council findings already gathered."
  }
  return "Athena indicated handoff to Atlas. Continue from the current session context and implement the agreed fixes from the council findings."
}
