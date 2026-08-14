export interface ReflectionFailureError {
  readonly code?: string
  readonly syscall?: string
  readonly path?: string
}

export function reflectionFailureError(error: unknown): ReflectionFailureError | undefined {
  if (error === null || typeof error !== "object") return undefined
  const record = error as Record<string, unknown>
  const fields: ReflectionFailureError = {
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    ...(typeof record.syscall === "string" ? { syscall: record.syscall } : {}),
    ...(typeof record.path === "string" ? { path: record.path } : {}),
  }
  return fields.code === undefined && fields.syscall === undefined && fields.path === undefined
    ? undefined
    : fields
}

export function isReflectionFailureError(value: unknown): value is ReflectionFailureError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (record.code === undefined || typeof record.code === "string")
    && (record.syscall === undefined || typeof record.syscall === "string")
    && (record.path === undefined || typeof record.path === "string")
    && (record.code !== undefined || record.syscall !== undefined || record.path !== undefined)
}
