export type ProxyProvider = "oxylabs" | "smartproxy" | "iproyal" | "custom"

export type ProxyProtocol = "http" | "socks5"

export type ProxySession = {
  server: string
  username: string
  password: string
  sessionId: string
}

export type BuildProxyOptions = {
  provider: ProxyProvider
  endpoint: string
  username: string
  password: string
  protocol?: ProxyProtocol
  country?: string
  city?: string
  sessionMode?: "sticky" | "rotating"
  sessionDurationMinutes?: number
}

export function buildProxyUrl(options: BuildProxyOptions): ProxySession {
  const sessionId = generateSessionId()
  const scheme = resolveScheme(options.protocol)

  switch (options.provider) {
    case "oxylabs":
      return buildOxylabsProxy(options, sessionId, scheme)
    case "smartproxy":
    case "iproyal":
    case "custom":
      return {
        server: `${scheme}://${options.endpoint}`,
        username: options.username,
        password: options.password,
        sessionId,
      }
  }
}

function buildOxylabsProxy(options: BuildProxyOptions, sessionId: string, scheme: string): ProxySession {
  const country = options.country ?? "IT"
  const customerPrefix = options.username.startsWith("customer-")
    ? options.username
    : `customer-${options.username}`
  const parts = [customerPrefix]
  parts.push(`cc-${country}`)

  if (options.city) {
    parts.push(`city-${options.city}`)
  }

  if (options.sessionMode === "sticky") {
    parts.push(`sessid-${sessionId}`)
    const duration = options.sessionDurationMinutes ?? 30
    parts.push(`sesstime-${duration}`)
  }

  return {
    server: `${scheme}://${options.endpoint}`,
    username: parts.join("-"),
    password: options.password,
    sessionId,
  }
}

function resolveScheme(protocol: ProxyProtocol | undefined): string {
  return protocol === "socks5" ? "socks5" : "http"
}

function generateSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function rotateSession(current: ProxySession, options: BuildProxyOptions): ProxySession {
  return buildProxyUrl(options)
}
