const PROXY_MARKER = "__proxy_url__"

export type ProxyConfigParse = {
  proxyUrl: string | null
  headers: Record<string, string>
}

export function extractProxyUrl(defaultHeadersJson: string | null | undefined): ProxyConfigParse {
  if (!defaultHeadersJson) return { proxyUrl: null, headers: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(defaultHeadersJson)
  } catch {
    return { proxyUrl: null, headers: {} }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { proxyUrl: null, headers: {} }
  }
  const obj = parsed as Record<string, unknown>
  let proxyUrl: string | null = null
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === PROXY_MARKER) {
      if (typeof value === "string" && value.length > 0) proxyUrl = value
      continue
    }
    if (typeof value === "string") headers[key] = value
  }
  return { proxyUrl, headers }
}

export function isProxyMarkerKey(key: string): boolean {
  return key === PROXY_MARKER
}

export const PROXY_URL_MARKER = PROXY_MARKER
