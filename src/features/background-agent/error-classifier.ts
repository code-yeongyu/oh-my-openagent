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

  if (isRecord(error)) {
    const dataRaw = error["data"]
    const candidates: unknown[] = [
      dataRaw,
      isRecord(dataRaw) ? (dataRaw as Record<string, unknown>)["error"] : undefined,
      error["error"],
      error["cause"],
      error,
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

  if (error instanceof Error) return error.message

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function extractErrorStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined

  for (const key of ["statusCode", "status", "code"]) {
    const val = (error as Record<string, unknown>)[key]
    if (typeof val === "number" && val >= 100 && val < 600) return val
  }

  const statusVal = (error as Record<string, unknown>)["status"]
  if (typeof statusVal === "string") {
    const parsed = parseInt(statusVal, 10)
    if (parsed >= 100 && parsed < 600) return parsed
  }

  const responseRaw = (error as Record<string, unknown>)["response"]
  if (isRecord(responseRaw)) {
    const respStatus = responseRaw["status"]
    if (typeof respStatus === "number" && respStatus >= 100 && respStatus < 600) return respStatus
    if (typeof respStatus === "string") {
      const parsed = parseInt(respStatus, 10)
      if (parsed >= 100 && parsed < 600) return parsed
    }
  }

  return undefined
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
