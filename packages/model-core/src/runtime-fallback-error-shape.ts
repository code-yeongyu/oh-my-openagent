const DEFAULT_RETRY_ON_ERRORS = [429, 500, 502, 503, 504] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getRecordValue(record: Record<string, unknown> | undefined, key: string): unknown {
  return record?.[key]
}

function getNestedRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = getRecordValue(record, key)
  return isRecord(value) ? value : undefined
}

export function getRuntimeFallbackErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()

  if (!isRecord(error)) {
    try {
      return JSON.stringify(error).toLowerCase()
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error
      }
      return ""
    }
  }

  const data = getNestedRecord(error, "data")
  const nestedError = getNestedRecord(error, "error")
  const dataError = getNestedRecord(data, "error")
  const records = [data, nestedError, error, dataError].filter((value): value is Record<string, unknown> => value !== undefined)

  for (const record of records) {
    const message = getRecordValue(record, "message")
    if (typeof message === "string" && message.length > 0) {
      return message.toLowerCase()
    }
  }

  const name = getRecordValue(error, "name")
  if (typeof name === "string" && name.length > 0) {
    const nameColonMatch = name.match(/:\s*(.+)/)
    if (nameColonMatch) return nameColonMatch[1]?.trim().toLowerCase() ?? ""
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return ""
  }
}

export function getRuntimeFallbackStatusCode(
  error: unknown,
  retryOnErrors?: readonly number[],
): number | undefined {
  if (isRecord(error)) {
    const topLevelStatusCode = getRecordValue(error, "statusCode")
    if (typeof topLevelStatusCode === "number") return topLevelStatusCode

    const topLevelStatus = getRecordValue(error, "status")
    if (typeof topLevelStatus === "number") return topLevelStatus
  }

  const root = isRecord(error) ? error : undefined
  const data = getNestedRecord(root, "data")
  const nestedError = getNestedRecord(root, "error")
  const cause = getNestedRecord(root, "cause")

  for (const record of [data, nestedError, cause]) {
    const statusCode = getRecordValue(record, "statusCode")
    if (typeof statusCode === "number") return statusCode
  }

  const retryCodes = retryOnErrors ?? DEFAULT_RETRY_ON_ERRORS
  const pattern = new RegExp(`\\b(${retryCodes.join("|")})\\b`)
  const message = getRuntimeFallbackErrorMessage(error)
  const statusMatch = message.match(pattern)
  if (statusMatch?.[1]) {
    return Number.parseInt(statusMatch[1], 10)
  }

  return undefined
}

export function getRuntimeFallbackErrorName(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined

  const data = getNestedRecord(error, "data")
  const nestedError = getNestedRecord(error, "error")
  const dataError = getNestedRecord(data, "error")
  const records = [error, data, nestedError, dataError].filter((value): value is Record<string, unknown> => value !== undefined)

  for (const record of records) {
    const name = getRecordValue(record, "name")
    if (typeof name === "string" && name.length > 0) {
      return name
    }
  }

  return undefined
}

export function getRuntimeFallbackRetryableSignal(error: unknown): boolean | undefined {
  if (!isRecord(error)) return undefined

  const data = getNestedRecord(error, "data")
  const nestedError = getNestedRecord(error, "error")
  const dataError = getNestedRecord(data, "error")
  const cause = getNestedRecord(error, "cause")
  const records = [error, data, nestedError, dataError, cause].filter((value): value is Record<string, unknown> => value !== undefined)

  for (const record of records) {
    const retryable = getRecordValue(record, "isRetryable")
    if (typeof retryable === "boolean") return retryable
  }

  return undefined
}
