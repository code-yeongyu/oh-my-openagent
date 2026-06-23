import { request as playwrightRequest } from "playwright-core"

export type ProxyConfig =
  | string
  | {
      server: string
      username?: string
      password?: string
    }

export type GeoIpLookupResult = {
  ip: string
  resolvedAt: number
}

const IP_LOOKUP_URL = "https://api.ipify.org?format=json"
const LOOKUP_TIMEOUT_MS = 15_000

export async function resolveProxyEgressIp(proxy: ProxyConfig): Promise<GeoIpLookupResult> {
  const proxyOption = normalizeProxy(proxy)
  const ctx = await playwrightRequest.newContext({
    proxy: proxyOption,
    timeout: LOOKUP_TIMEOUT_MS,
  })
  try {
    const response = await ctx.get(IP_LOOKUP_URL, { timeout: LOOKUP_TIMEOUT_MS })
    if (!response.ok()) {
      throw new Error(`ipify lookup failed: HTTP ${response.status()}`)
    }
    const body = (await response.json()) as { ip?: unknown }
    const ip = typeof body.ip === "string" ? body.ip.trim() : ""
    if (!ip) {
      throw new Error(`ipify lookup returned no ip field: ${JSON.stringify(body)}`)
    }
    return { ip, resolvedAt: Date.now() }
  } finally {
    await ctx.dispose().catch(() => {})
  }
}

function normalizeProxy(proxy: ProxyConfig): { server: string; username?: string; password?: string } {
  if (typeof proxy === "string") {
    const url = new URL(proxy)
    const username = url.username ? decodeURIComponent(url.username) : undefined
    const password = url.password ? decodeURIComponent(url.password) : undefined
    url.username = ""
    url.password = ""
    return {
      server: url.toString().replace(/\/$/, ""),
      ...(username !== undefined ? { username } : {}),
      ...(password !== undefined ? { password } : {}),
    }
  }
  return {
    server: proxy.server,
    ...(proxy.username !== undefined ? { username: proxy.username } : {}),
    ...(proxy.password !== undefined ? { password: proxy.password } : {}),
  }
}
