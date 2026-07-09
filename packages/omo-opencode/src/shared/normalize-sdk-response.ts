import { sanitizeSurrogates } from "./sanitize-surrogates"

export interface NormalizeSDKResponseOptions {
  preferResponseOnMissingData?: boolean
}

function sanitizeSDKValue<TData>(value: TData, seen = new WeakMap<object, unknown>()): TData {
  if (typeof value === "string") {
    return sanitizeSurrogates(value) as TData
  }

  if (value === null || typeof value !== "object") {
    return value
  }

  const objectValue = value as object
  const seenValue = seen.get(objectValue)
  if (seenValue) return seenValue as TData

  if (Array.isArray(value)) {
    const sanitizedItems: unknown[] = []
    seen.set(objectValue, sanitizedItems)
    let changed = false
    for (const item of value) {
      const sanitizedItem = sanitizeSDKValue(item, seen)
      sanitizedItems.push(sanitizedItem)
      if (sanitizedItem !== item) changed = true
    }
    return (changed ? sanitizedItems : value) as TData
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return value
  }

  const record = value as Record<string, unknown>
  const sanitizedRecord: Record<string, unknown> = {}
  seen.set(objectValue, sanitizedRecord)
  let changed = false
  for (const [key, item] of Object.entries(record)) {
    const sanitizedItem = sanitizeSDKValue(item, seen)
    sanitizedRecord[key] = sanitizedItem
    if (sanitizedItem !== item) changed = true
  }
  return (changed ? sanitizedRecord : value) as TData
}

export function normalizeSDKResponse<TData>(
  response: unknown,
  fallback: TData,
  options?: NormalizeSDKResponseOptions,
): TData {
  if (response == null) {
    return fallback
  }

  if (Array.isArray(response)) {
    return sanitizeSDKValue(response as TData)
  }

  if (typeof response === "object" && "data" in response) {
    const data = (response as { data?: unknown }).data
    if (data != null) {
      return sanitizeSDKValue(data as TData)
    }

    if (options?.preferResponseOnMissingData === true) {
      return response as TData
    }

    return fallback
  }

  if (options?.preferResponseOnMissingData === true) {
    return sanitizeSDKValue(response as TData)
  }

  return fallback
}
