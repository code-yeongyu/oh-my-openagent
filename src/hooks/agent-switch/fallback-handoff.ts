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


