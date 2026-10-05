import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export interface EngineCall {
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

export interface EngineResult {
  readonly exitCode: number
  readonly stdout?: string
  readonly stderr?: string
}

export function scriptedEngine(
  responder: (args: readonly string[], call: number) => EngineResult,
) {
  const calls: EngineCall[] = []
  return {
    calls,
    run(args: string[], options: { env: Record<string, string> }) {
      calls.push({ args: [...args], env: { ...options.env } })
      const result = responder(args, calls.length)
      return { exitCode: result.exitCode, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
    },
  }
}

export function workspace(): { readonly root: string; readonly pluginRoot: string; readonly agentDir: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-daemon-shards-"))
  const pluginRoot = join(root, "plugin")
  const agentDir = join(root, "agent")
  mkdirSync(pluginRoot, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(
    join(pluginRoot, "daemon-launch-spec.json"),
    JSON.stringify({ schemaVersion: 1, argv: ["--mode", "rpc"], env: {} }),
  )
  return { root, pluginRoot, agentDir }
}

export function capture() {
  const chunks: string[] = []
  return { chunks, write: (text: string) => void chunks.push(text), text: () => chunks.join("") }
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function endpoint(
  socket: string,
  options: {
    readonly reachable?: boolean
    readonly pid?: number
    readonly generation?: number
    readonly engineVersion?: string
    readonly sessions?: number
    readonly rss?: number
    readonly hostRss?: number
    readonly fds?: number
    readonly crashes?: number
    readonly shard?: { readonly kind: "p" | "i"; readonly key: string } | null
    readonly generations?: readonly Record<string, unknown>[]
    readonly claimsLive?: number
  } = {},
) {
  const reachable = options.reachable ?? true
  const generation = options.generation ?? 1
  const pid = options.pid ?? 100
  return {
    reachable,
    socket,
    dir: `${socket}.state`,
    identity: "endpoint",
    pid: reachable ? pid : null,
    instanceId: reachable ? `instance-${pid}` : null,
    generation: reachable ? generation : null,
    engineVersion: reachable ? (options.engineVersion ?? "2026.9.28+1.test") : null,
    capabilities: [],
    launchProfile: null,
    sessions: {
      total: options.sessions ?? 0,
      interactive: 0,
      worker: options.sessions ?? 0,
      retained: 0,
      foreign_attached: 0,
      foreign_retained: 0,
    },
    zombies: 0,
    rss_mb: options.rss ?? 10,
    host_rss_mb: options.hostRss ?? 8,
    open_fds: options.fds ?? 5,
    memory_pressure: false,
    env_keys: [],
    generations: options.generations ?? [{
      instanceId: `instance-${pid}`,
      generation,
      pid,
      engineVersion: options.engineVersion ?? "2026.9.28+1.test",
      rss_mb: options.rss ?? 10,
      host_rss_mb: options.hostRss ?? 8,
      sessions: options.sessions ?? 0,
      current: true,
      alive: reachable,
    }],
    crashes: options.crashes ?? 0,
    shard: options.shard ?? null,
    session_rows: [],
    claims_live: options.claimsLive ?? 0,
    claims: [],
  }
}
