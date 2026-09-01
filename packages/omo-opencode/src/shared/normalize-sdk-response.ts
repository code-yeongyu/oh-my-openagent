export interface NormalizeSDKResponseOptions {
  /** Return the raw response when data is missing, except when the fallback requires an array. */
  preferResponseOnMissingData?: boolean
}

export function normalizeSDKResponse<TData>(
  response: unknown,
  fallback: TData,
  options?: NormalizeSDKResponseOptions,
): TData {
  const fallbackIsArray = Array.isArray(fallback)

  if (response == null) {
    return fallback
  }

  if (Array.isArray(response)) {
    return response as TData
  }

  if (typeof response === "object" && "data" in response) {
    const data = (response as { data?: unknown }).data
    if (data != null) {
      if (fallbackIsArray && !Array.isArray(data)) {
        return fallback
      }
      return data as TData
    }

    if (options?.preferResponseOnMissingData === true && !fallbackIsArray) {
      return response as TData
    }

    return fallback
  }

  if (options?.preferResponseOnMissingData === true && !fallbackIsArray) {
    return response as TData
  }

  return fallback
}
