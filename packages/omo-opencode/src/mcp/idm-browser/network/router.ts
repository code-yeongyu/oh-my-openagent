export type NetworkLane = "browser" | "impit" | "direct"

export type RouteDecision = {
  lane: NetworkLane
  reason: string
}

export function routeRequest(url: string, method: string): RouteDecision {
  const parsed = new URL(url)

  if (needsBrowserRendering(parsed)) {
    return { lane: "browser", reason: "page requires JS rendering" }
  }

  if (isApiEndpoint(parsed, method)) {
    return { lane: "impit", reason: "API call benefits from TLS impersonation" }
  }

  return { lane: "direct", reason: "simple request, no special handling needed" }
}

function needsBrowserRendering(url: URL): boolean {
  const renderHeavyDomains = [
    "quillbot.com",
    "plagiarismdetector.net",
    "quetext.com",
    "discord.com",
  ]
  return renderHeavyDomains.some(d => url.hostname.endsWith(d))
}

function isApiEndpoint(url: URL, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return true
  if (url.pathname.startsWith("/api/")) return true
  if (url.pathname.includes("/v1/") || url.pathname.includes("/v2/")) return true
  return false
}
