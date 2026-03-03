export interface NormalizeSDKResponseOptions {
  preferResponseOnMissingData?: boolean
}

export function normalizeSDKResponse<TData>(
  response: unknown,
  fallback: TData,
  options?: NormalizeSDKResponseOptions,
): TData {
  if (response === null || response === undefined) {
    return fallback
  }

  if (Array.isArray(response)) {
    return response as TData
  }

  if (typeof response === "object" && "data" in response) {
    const data = (response as { data?: unknown }).data
    if (data !== null && data !== undefined) {
      return data as TData
    }

    if (options?.preferResponseOnMissingData === true) {
      return response as TData
    }

    return fallback
  }

  if (options?.preferResponseOnMissingData === true) {
    return response as TData
  }

  return fallback
}
