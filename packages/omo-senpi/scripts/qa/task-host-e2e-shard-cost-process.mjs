import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { stopParent } from "./task-host-e2e-events.mjs"
import { lastJsonLine, pidAlive, runBin, sandboxProcesses, waitFor } from "./task-host-e2e-process.mjs"

export function endpointSockets(sandbox) {
  const rpc = join(sandbox.agentDir, "rpc")
  const shards = join(rpc, "shards")
  return [
    ...(existsSync(join(rpc, "rpc.sock")) ? [join(rpc, "rpc.sock")] : []),
    ...(existsSync(shards) ? readdirSync(shards).filter((name) => name.endsWith(".sock")).sort().map((name) => join(shards, name)) : []),
  ]
}

export function shardOwners(sandbox) {
  const shards = join(sandbox.agentDir, "rpc", "shards")
  if (!existsSync(shards)) return {}
  return Object.fromEntries(readdirSync(shards).filter((name) => name.endsWith(".meta.json")).flatMap((name) => {
    try {
      const meta = JSON.parse(readFileSync(join(shards, name), "utf8"))
      return [[meta.socket, meta.owner_session_id]]
    } catch {
      return []
    }
  }))
}

export function hostStatus(sandbox, socket, { includeWorkers = true } = {}) {
  const result = runBin(sandbox, ["host", "status", "--socket", socket, ...(includeWorkers ? ["--include-workers"] : []), "--json"], { timeoutMs: 30_000 })
  return { exitCode: result.status, json: lastJsonLine(result.stdout) ?? null }
}

export const STATUS_ALL_FIELDS = ["crashes", "shard", "session_rows", "claims_live", "claims", "memory_pressure"]

export function statusAll(sandbox) {
  const result = runBin(sandbox, ["host", "status", "--all", "--include-workers", "--json"], { timeoutMs: 60_000 })
  const parsed = lastJsonLine(result.stdout)
  if (result.status === 0 && Array.isArray(parsed?.endpoints)) {
    return {
      mode: "all",
      fieldsPresent: STATUS_ALL_FIELDS.filter((field) => parsed.endpoints.every((report) => field in report)),
      endpoints: parsed.endpoints,
    }
  }
  return {
    mode: "degraded",
    reason: `${(result.stderr || result.stdout).trim().split("\n")[0] ?? ""} (exit ${result.status})`,
    endpoints: endpointSockets(sandbox).map((socket) => ({ ...(hostStatus(sandbox, socket).json ?? { socket, reachable: false }), socket })),
  }
}

export function supervisorPid(sandbox, socket) {
  try {
    const dir = join(sandbox.agentDir, "rpc-host-daemon", createHash("sha256").update(socket).digest("hex").slice(0, 16))
    const pointer = JSON.parse(readFileSync(join(dir, "host.pid"), "utf8"))
    const generation = JSON.parse(readFileSync(join(dir, pointer.generation_dir, "host.pid"), "utf8"))
    return typeof generation.pid === "number" ? generation.pid : undefined
  } catch {
    return undefined
  }
}

export function processTable() {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,args="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return new Map(rows.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return match === null ? [] : [[Number(match[1]), { pid: Number(match[1]), ppid: Number(match[2]), rssKb: Number(match[3]), args: match[4] }]]
  }))
}

export function treePids(root, table = processTable()) {
  if (!table.has(root)) return []
  const out = [root]
  for (let index = 0; index < out.length; index += 1) {
    for (const entry of table.values()) if (entry.ppid === out[index]) out.push(entry.pid)
  }
  return out
}

export function footprintMb(pid) {
  try {
    if (process.platform === "darwin") {
      const text = execFileSync("vmmap", ["--summary", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 })
      const match = /Physical footprint:\s+([\d.]+)([KMG])/.exec(text)
      if (match === null) return undefined
      return Math.round(Number(match[1]) * { K: 1 / 1024, M: 1, G: 1024 }[match[2]] * 10) / 10
    }
    const match = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"))
    return match === null ? undefined : Math.round((Number(match[1]) / 1024) * 10) / 10
  } catch {
    return undefined
  }
}

function role(entry, rootPid) {
  if (entry.pid === rootPid) return "supervisor"
  if (entry.args.includes("--mode rpc")) return "host"
  if (entry.args.includes("ast-grep") || entry.args.includes("ast_grep")) return "ast_grep_mcp"
  return "other"
}

const round = (value) => Math.round(value * 10) / 10

export function sampleEndpoint(socket, supervisor, table = processTable()) {
  const pids = supervisor === undefined ? [] : treePids(supervisor, table)
  const processes = pids.map((pid) => {
    const entry = table.get(pid)
    return { pid, role: role(entry, supervisor), rss_mb: round(entry.rssKb / 1024), footprint_mb: footprintMb(pid) ?? null }
  })
  const sum = (field, filter = () => true) => round(processes.filter(filter).reduce((total, entry) => total + (entry[field] ?? Number.NaN), 0))
  return {
    socket: socket.split("/").slice(-1)[0],
    supervisor_pid: supervisor ?? null,
    alive: processes.length > 0,
    processes,
    supervisor_rss_mb: sum("rss_mb", (entry) => entry.role === "supervisor"),
    host_rss_mb: sum("rss_mb", (entry) => entry.role === "host"),
    endpoint_rss_mb: sum("rss_mb"),
    supervisor_footprint_mb: sum("footprint_mb", (entry) => entry.role === "supervisor"),
    host_footprint_mb: sum("footprint_mb", (entry) => entry.role === "host"),
    endpoint_footprint_mb: sum("footprint_mb"),
  }
}

export function totalOf(samples) {
  const alive = samples.filter((sample) => sample.alive)
  return {
    endpoints_alive: alive.length,
    rss_mb: round(alive.reduce((total, sample) => total + sample.endpoint_rss_mb, 0)),
    footprint_mb: round(alive.reduce((total, sample) => total + sample.endpoint_footprint_mb, 0)),
  }
}

export async function stopEndpoint(sandbox, socket) {
  const supervisor = supervisorPid(sandbox, socket)
  const pids = supervisor === undefined ? [] : treePids(supervisor)
  const stop = runBin(sandbox, ["host", "stop", "--socket", socket, "--force", "--json"], { timeoutMs: 60_000 })
  await waitFor(() => pids.every((pid) => !pidAlive(pid)), { timeoutMs: 30_000, intervalMs: 200 })
  for (const pid of pids.filter(pidAlive)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // gone between the check and the signal
    }
  }
  const gc = runBin(sandbox, ["host", "gc", "--socket", socket, "--json"], { timeoutMs: 30_000 })
  return {
    socket: socket.split("/").slice(-1)[0],
    pids,
    stopExit: stop.status,
    stillAlive: pids.filter(pidAlive),
    gc: gc.status === 0 ? "removed" : `unsupported (exit ${gc.status}: ${(gc.stderr || gc.stdout).trim().split("\n")[0] ?? ""})`,
  }
}

export async function teardownSandbox(sandbox, parents = []) {
  for (const parent of parents) await stopParent(parent).catch(() => undefined)
  const endpoints = []
  for (const socket of endpointSockets(sandbox)) endpoints.push(await stopEndpoint(sandbox, socket))
  const survivors = await killSurvivors(sandbox)
  // A process that was still exiting (a host generation respawned after a crash scenario) can write into
  // the tree while it is removed: sweep again and retry instead of losing the whole section to ENOTEMPTY.
  for (let attempt = 0; ; attempt += 1) {
    try {
      rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      break
    } catch (error) {
      if (attempt >= 3 || error?.code !== "ENOTEMPTY") throw error
      survivors.push(...(await killSurvivors(sandbox)))
    }
  }
  return {
    sandbox: sandbox.name,
    parentPids: parents.map((parent) => parent.child.pid),
    parentsAlive: parents.map((parent) => parent.child.pid).filter(pidAlive),
    endpoints,
    killedSurvivors: survivors,
    removed: !existsSync(sandbox.root),
  }
}

async function killSurvivors(sandbox) {
  const survivors = sandboxProcesses(sandbox).map((entry) => entry.pid)
  for (const pid of survivors) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // gone
    }
  }
  await waitFor(() => survivors.every((pid) => !pidAlive(pid)), { timeoutMs: 10_000, intervalMs: 100 })
  return survivors
}

export function settle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
