function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined
}

function getStringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export interface SessionErrorInfo {
  name?: string
  message?: string
}

/**
 * Normalize the many shapes an opencode `session.error` event payload can take
 * (`error` as Error instance, plain object, `{ data: { error } }`, string) into a
 * flat `{ name, message }` pair that classifiers can match on.
 */
export function extractSessionErrorInfo(error: unknown): SessionErrorInfo | undefined {
  if (!error) return undefined
  if (typeof error === "string") return { message: error }
  if (error instanceof Error) return { name: error.name, message: error.message }

  const root = asRecord(error)
  if (!root) return { message: String(error) }

  const data = asRecord(root.data)
  const nestedError = asRecord(root.error)
  const dataError = asRecord(data?.error)

  const name = getStringField(root, "name")
    ?? getStringField(data, "name")
    ?? getStringField(nestedError, "name")
    ?? getStringField(dataError, "name")

  const messageParts = [
    getStringField(root, "message"),
    getStringField(data, "message"),
    getStringField(nestedError, "message"),
    getStringField(dataError, "message"),
    getStringField(root, "code"),
    getStringField(nestedError, "code"),
    getStringField(dataError, "code"),
  ].filter((message): message is string => typeof message === "string")

  return { name, message: messageParts.join(" ") || undefined }
}
