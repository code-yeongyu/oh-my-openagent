/// <reference types="bun-types" />
import { afterAll } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const AGENT_DIR_ENV_NAMES = ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"] as const

export interface HermeticHome {
  readonly home: string
  readonly agentDir: string
}

// os.homedir() keeps the OS home it read at process start and ignores a later HOME change, so the
// engine's agent-dir lookup (these variables first, os.homedir() otherwise) would still land in the
// user's real agent dir: a test that starts a session or a task host then writes there (#9578).
// Every reader takes the first set name in OMO > SENPI > PI order. The two that a run inherited from
// a live omo session are dropped and only the LAST is pinned to the hermetic home, so a test that sets
// OMO_ or SENPI_CODING_AGENT_DIR for itself or a child still wins exactly as it did before.
export function installHermeticHome(): HermeticHome {
  const home = mkdtempSync(join(tmpdir(), "omo-test-home-"))
  process.env.HOME = home
  process.env.USERPROFILE = home
  const agentDir = join(home, ".omo", "agent")
  for (const name of AGENT_DIR_ENV_NAMES) delete process.env[name]
  process.env.PI_CODING_AGENT_DIR = agentDir
  afterAll(() => {
    stopHostsUnder(home)
    failOnShardsInRealAgentDir()
  })
  return { home, agentDir }
}

// A test that boots the packaged extension can warm a real task host. With the agent dir pinned above,
// that host's socket lives under this process's own temp home, which is how it is attributed here: no
// other process can own a path inside a mkdtemp dir created by this one.
function stopHostsUnder(home: string): void {
  if (process.platform === "win32") return
  const listing = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).stdout ?? ""
  for (const line of listing.split("\n")) {
    if (!line.includes(`${home}/`)) continue
    const pid = Number.parseInt(line.trim(), 10)
    if (!Number.isInteger(pid) || pid === process.pid) continue
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Already gone between the listing and the signal.
    }
  }
}

const REAL_AGENT_DIRS = [join(homedir(), ".omo", "agent"), join(homedir(), ".senpi", "agent"), join(homedir(), ".omo")]

// A host shard registered under a real agent dir by THIS test process is a leak. The shard meta
// records its creator, so a live session's own shards on the same machine are never counted.
function failOnShardsInRealAgentDir(): void {
  const leaked = REAL_AGENT_DIRS.flatMap((agentDir) => shardsCreatedBy(join(agentDir, "rpc", "shards"), process.pid))
  if (leaked.length === 0) return
  throw new Error(
    `test process ${process.pid} registered task host shards in the real agent dir (#9578): ${leaked.join(", ")}`,
  )
}

function shardsCreatedBy(shardsDir: string, pid: number): string[] {
  let names: string[]
  try {
    names = readdirSync(shardsDir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith(".meta.json"))
    .map((name) => join(shardsDir, name))
    .filter((metaPath) => readCreatorPid(metaPath) === pid)
}

function readCreatorPid(metaPath: string): unknown {
  try {
    return (JSON.parse(readFileSync(metaPath, "utf8")) as { created_by_pid?: unknown }).created_by_pid
  } catch {
    return undefined
  }
}
