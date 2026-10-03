import type { MissionScope, ScopeEntry } from "./types"

export function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase()
  try {
    const url = host.includes("://") ? new URL(host) : new URL(`http://${host}`)
    host = url.hostname
  } catch {
    // not a URL, treat as bare host
  }
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1)
  }
  if (host.startsWith("www.")) host = host.slice(4)
  const cidrMatch = host.match(/^(.+?)\/\d+$/)
  if (cidrMatch) host = cidrMatch[1]
  return host
}

function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost")
  )
}

function isPrivate(host: string): boolean {
  if (isLoopback(host)) return false
  const parts = host.split(".")
  if (parts.length === 4) {
    const [a, b] = parts.map(Number)
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}

export function scopeViolation(
  scope: MissionScope,
  targetHost: string,
): string | null {
  const host = normalizeHost(targetHost)
  if (host === "") return "empty host"

  const allowed = scope.allowed_hosts.map((e) => normalizeHost(e.host))
  if (allowed.includes(host)) return null

  if (isLoopback(host)) {
    if (!scope.allow_loopback) {
      return `loopback host ${host} not allowed without allow_loopback`
    }
    return null
  }

  if (isPrivate(host)) {
    if (!scope.allow_private) {
      return `private host ${host} not allowed without allow_private`
    }
    return null
  }

  return `host ${host} not in allowed scope`
}

export function checkPathScope(
  scope: MissionScope,
  path: string,
): string | null {
  if (scope.allowed_paths.length === 0) return null
  const normalized = path.replace(/\\/g, "/")
  if (normalized.includes("/../") || normalized.includes("/..") || normalized.startsWith("../")) {
    return `path ${path} contains traversal segments`
  }
  const matched = scope.allowed_paths.some((allowed) => {
    const norm = allowed.replace(/\\/g, "/")
    return normalized === norm || normalized.startsWith(norm + "/")
  })
  return matched ? null : `path ${path} not in allowed scope`
}

export function buildScopeFromEntries(
  hosts: ScopeEntry[],
  paths: string[] = [],
): MissionScope {
  return {
    allowed_hosts: hosts,
    allowed_paths: paths,
    allow_loopback: false,
    allow_private: false,
  }
}
