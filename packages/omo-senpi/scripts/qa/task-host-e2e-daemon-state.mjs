// The daemon's own state on disk, read the way the plan's checks read it: the v2 pointer chain that
// names the generation serving the socket, the writer that started it, its zombie children, and the
// host log. A flat legacy pidfile is deliberately never read - a v2 client must not mistake one for its
// own - and every reader answers `undefined` rather than throwing on a half-written state dir.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

function readGeneration(agentDir) {
  const root = join(agentDir, "rpc-host-daemon")
  const layout = JSON.parse(readFileSync(join(root, "layout.json"), "utf8"))
  const pointer = JSON.parse(readFileSync(join(root, layout.dir, "host.pid"), "utf8"))
  return JSON.parse(readFileSync(join(root, layout.dir, pointer.generation_dir, "host.pid"), "utf8"))
}

/** layout.json -> <dir>/host.pid -> generations/<instance>/host.pid -> .pid, the plan's zombie check. */
export function generationHostPid(agentDir) {
  try {
    const generation = readGeneration(agentDir)
    return typeof generation.pid === "number" ? generation.pid : undefined
  } catch {
    return undefined
  }
}

/**
 * WHO owns the current generation. `writer` is the client process that started it, which is what tells
 * a replaced daemon apart from a restarted one: a new instance with a new writer means another client
 * started its own host, while a new instance with the same writer is that client restarting its own.
 */
export function generationHostRecord(agentDir) {
  try {
    const generation = readGeneration(agentDir)
    return {
      pid: generation.pid ?? null,
      instanceId: generation.instance_id ?? null,
      generation: generation.generation ?? null,
      writerPid: generation.writer?.pid ?? null,
      launchProfileId: typeof generation.launchProfileId === "string" ? generation.launchProfileId.slice(0, 12) : null,
    }
  } catch {
    return undefined
  }
}

/** Zombies parented by THIS host pid - darwin `ps -axo`, linux `ps -eo`, same awk selection. */
export function zombieChildCount(hostPid) {
  const flag = process.platform === "darwin" ? "-axo" : "-eo"
  try {
    return execFileSync("ps", [flag, "ppid=,stat="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => Number(parts[0]) === hostPid && /^Z/.test(parts[1] ?? "")).length
  } catch {
    return undefined
  }
}

/** The host's own log, captured BEFORE the sandbox is removed - the transcript's only view inside it. */
export function daemonStderrTail(agentDir, limit = 25) {
  const root = join(agentDir, "rpc-host-daemon")
  if (!existsSync(root)) return []
  return readdirSync(root)
    .flatMap((entry) => {
      const path = join(root, entry, "stderr.log")
      return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0) : []
    })
    .slice(-limit)
}
