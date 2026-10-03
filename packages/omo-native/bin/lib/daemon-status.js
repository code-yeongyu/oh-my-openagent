import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

function readJson(path) {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function sidecarPath(endpoint, agentDir) {
  if (endpoint.shard === null || endpoint.shard === undefined) return undefined
  if (typeof endpoint.socket === "string") {
    return join(dirname(endpoint.socket), `${endpoint.shard.kind}-${endpoint.shard.key}.meta.json`)
  }
  return join(agentDir, "rpc", "shards", `${endpoint.shard.kind}-${endpoint.shard.key}.meta.json`)
}

export function decorateEndpoints(endpoints, agentDir) {
  return endpoints.map((endpoint) => {
    const path = sidecarPath(endpoint, agentDir)
    const owner = path === undefined ? undefined : readJson(path)
    return owner === undefined ? endpoint : { ...endpoint, owner }
  })
}

export function aggregateEndpoints(endpoints) {
  const live = endpoints.filter((endpoint) => endpoint.reachable)
  return {
    live: live.length,
    shards: live.filter((endpoint) => endpoint.shard?.kind === "p").length,
    threads: live.filter((endpoint) => endpoint.shard?.kind === "i").length,
    sessions: live.reduce((total, endpoint) => total + (endpoint.sessions?.total ?? 0), 0),
    rss_mb: live.reduce((total, endpoint) => total + (endpoint.rss_mb ?? 0), 0),
    host_rss_mb: live.reduce((total, endpoint) => total + (endpoint.host_rss_mb ?? 0), 0),
    crashes: endpoints.reduce((total, endpoint) => total + (endpoint.crashes ?? 0), 0),
  }
}

function endpointKind(endpoint) {
  if (endpoint.shard?.kind === "p") return "shard"
  if (endpoint.shard?.kind === "i") return "thread"
  if (typeof endpoint.socket === "string" && basename(endpoint.socket) === "rpc.sock") return "daemon"
  return "endpoint"
}

function endpointName(endpoint) {
  const kind = endpointKind(endpoint)
  if (kind === "daemon") return "daemon"
  if (kind === "shard") {
    const owner = endpoint.owner?.owner_session_id
    const file = endpoint.owner?.owner_session_file
    const suffix = [owner === undefined ? undefined : `parent ${owner.slice(0, 8)}`, file === undefined ? undefined : basename(file)]
      .filter(Boolean)
      .join(", ")
    return `shard p-${endpoint.shard.key}${suffix === "" ? "" : ` (${suffix})`}`
  }
  if (kind === "thread") {
    const owner = endpoint.owner?.owner_session_id
    return `thread i-${endpoint.shard.key}${owner === undefined ? "" : ` (thread ${owner.slice(0, 8)})`}`
  }
  return `endpoint ${typeof endpoint.socket === "string" ? basename(endpoint.socket) : basename(endpoint.dir ?? "unknown")}`
}

function metric(value) {
  return value === null || value === undefined ? "?" : String(value)
}

function runningDetails(endpoint, includeGeneration = true) {
  const parts = [
    `running pid ${metric(endpoint.pid)}`,
    includeGeneration && endpoint.generation !== null && endpoint.generation !== undefined
      ? `gen ${endpoint.generation}`
      : undefined,
    endpoint.engineVersion === null || endpoint.engineVersion === undefined ? undefined : `engine ${endpoint.engineVersion}`,
    `${endpoint.sessions?.total ?? 0} session(s)`,
    `rss ${metric(endpoint.rss_mb)} MB (host ${metric(endpoint.host_rss_mb)} MB)`,
    `fds ${metric(endpoint.open_fds)}`,
    `crashes ${endpoint.crashes ?? 0}`,
  ].filter(Boolean)
  return parts.join(" · ")
}

function generationLine(generation, endpoint) {
  const state = generation.current ? "current" : "draining"
  const sessions = generation.sessions ?? endpoint.sessions?.total ?? 0
  return `  gen ${generation.generation} (${state}) pid ${metric(generation.pid)} · engine ${generation.engineVersion ?? "?"} · ${sessions} session(s) · rss ${metric(generation.rss_mb)} MB (host ${metric(generation.host_rss_mb)} MB)`
}

export function formatEndpointLines(endpoints) {
  const lines = []
  for (const endpoint of endpoints) {
    const name = endpointName(endpoint)
    if (!endpoint.reachable) {
      lines.push(`${name}: not running (retained state kept; run omo daemon gc)`)
      continue
    }
    lines.push(`${name}: ${runningDetails(endpoint, endpointKind(endpoint) !== "daemon")}`)
    if ((endpoint.generations?.length ?? 0) > 1) {
      for (const generation of endpoint.generations) lines.push(generationLine(generation, endpoint))
    }
  }
  const aggregate = aggregateEndpoints(endpoints)
  lines.push(
    `hosts: ${aggregate.live} live (${aggregate.shards} shards, ${aggregate.threads} threads) · ${aggregate.sessions} session(s) · rss ${aggregate.rss_mb} MB (host ${aggregate.host_rss_mb} MB) · crashes ${aggregate.crashes} (recorded, newest 50 per endpoint)`,
  )
  return lines
}

export function formatDoctorLines(endpoints) {
  return formatEndpointLines(endpoints).map((line) => {
    const prefix = line.startsWith("hosts:")
      ? "INFO Hosts:"
      : line.includes(": not running")
        ? "WARN "
        : line.startsWith("  gen ")
          ? "INFO "
          : "INFO "
    if (line.startsWith("hosts:")) return `${prefix}${line.slice("hosts:".length)}`
    return `${prefix}${line[0]?.toUpperCase() ?? ""}${line.slice(1)}`
  })
}

export function statusPayload(endpoints) {
  return { endpoints, aggregate: aggregateEndpoints(endpoints) }
}
