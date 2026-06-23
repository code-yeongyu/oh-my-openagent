import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"
import type { CapsolverProxyConfig } from "./capsolver-client"
import type { AntiCaptchaProxyConfig } from "./anti-captcha-types"
import type { EngineProxy } from "../engines"

export function convertBrowserProxyToCapsolver(proxy: EngineProxy | undefined): CapsolverProxyConfig | null {
  const parts = extractProxyParts(proxy)
  if (!parts) return null
  return {
    proxyType: parts.proxyType,
    proxyAddress: parts.proxyAddress,
    proxyPort: parts.proxyPort,
    ...(parts.proxyLogin ? { proxyLogin: parts.proxyLogin } : {}),
    ...(parts.proxyPassword ? { proxyPassword: parts.proxyPassword } : {}),
  }
}

export async function convertBrowserProxyToAntiCaptcha(proxy: EngineProxy | undefined): Promise<AntiCaptchaProxyConfig | null> {
  const parts = extractProxyParts(proxy)
  if (!parts) return null
  const proxyAddress = isIP(parts.proxyAddress) ? parts.proxyAddress : await resolveHostnameToIp(parts.proxyAddress)
  if (!proxyAddress) return null
  return {
    proxyType: parts.proxyType,
    proxyAddress,
    proxyPort: parts.proxyPort,
    ...(parts.proxyLogin ? { proxyLogin: parts.proxyLogin } : {}),
    ...(parts.proxyPassword ? { proxyPassword: parts.proxyPassword } : {}),
  }
}

type ProxyParts = {
  proxyType: "http" | "https" | "socks4" | "socks5"
  proxyAddress: string
  proxyPort: number
  proxyLogin?: string
  proxyPassword?: string
}

function extractProxyParts(proxy: EngineProxy | undefined): ProxyParts | null {
  if (!proxy) return null
  const normalized = typeof proxy === "string" ? { server: proxy } : proxy
  if (!normalized.server) return null

  const parsed = parseProxyServer(normalized.server)
  if (!parsed) return null
  return {
    proxyType: parsed.proxyType,
    proxyAddress: parsed.proxyAddress,
    proxyPort: parsed.proxyPort,
    proxyLogin: normalized.username,
    proxyPassword: normalized.password,
  }
}

async function resolveHostnameToIp(hostname: string): Promise<string | null> {
  try {
    const { address } = await dnsLookup(hostname, { family: 4 })
    return address
  } catch {
    return null
  }
}

type ParsedProxyServer = {
  proxyType: "http" | "https" | "socks4" | "socks5"
  proxyAddress: string
  proxyPort: number
}

function parseProxyServer(server: string): ParsedProxyServer | null {
  const withScheme = server.includes("://") ? server : `http://${server}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  const scheme = url.protocol.replace(":", "").toLowerCase()
  const proxyType = normalizeProxyType(scheme)
  if (!proxyType) return null

  const port = Number.parseInt(url.port, 10)
  if (!Number.isFinite(port) || port <= 0) return null

  return { proxyType, proxyAddress: url.hostname, proxyPort: port }
}

function normalizeProxyType(scheme: string): ParsedProxyServer["proxyType"] | null {
  if (scheme === "http") return "http"
  if (scheme === "https") return "https"
  if (scheme === "socks4") return "socks4"
  if (scheme === "socks5" || scheme === "socks5h") return "socks5"
  return null
}
