export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function isAbortedSessionError(error: unknown): boolean {
  const message = getErrorText(error)
  return message.toLowerCase().includes("aborted")
}

export function getErrorText(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof error.message === "string") {
      return error.message
    }
    if ("name" in error && typeof error.name === "string") {
      return error.name
    }
  }
  return ""
}

export function extractErrorName(error: unknown): string | undefined {
  if (isRecord(error) && typeof error["name"] === "string") return error["name"]
  if (error instanceof Error) return error.name
  return undefined
}

export function extractErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message

  if (isRecord(error)) {
    const dataRaw = error["data"]
    const candidates: unknown[] = [
      error,
      dataRaw,
      error["error"],
      isRecord(dataRaw) ? (dataRaw as Record<string, unknown>)["error"] : undefined,
      error["cause"],
    ]

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.length > 0) return candidate
      if (
        isRecord(candidate) &&
        typeof candidate["message"] === "string" &&
        candidate["message"].length > 0
      ) {
        return candidate["message"]
      }
    }
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

interface EventPropertiesLike {
  [key: string]: unknown
}

export function getSessionErrorMessage(properties: EventPropertiesLike): string | undefined {
  const errorRaw = properties["error"]
  if (!isRecord(errorRaw)) return undefined

  const dataRaw = errorRaw["data"]
  if (isRecord(dataRaw)) {
    const message = dataRaw["message"]
    if (typeof message === "string") return message
  }

  const message = errorRaw["message"]
  return typeof message === "string" ? message : undefined
}
