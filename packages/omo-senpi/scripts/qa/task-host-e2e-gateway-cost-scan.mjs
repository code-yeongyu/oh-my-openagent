/**
 * What the gateway cost driver inspects outside the product: the `event loop blocked` line in every
 * pty stream and every sandbox agent dir (host `stderr.log` files included), process trees, the real
 * agent dir it must never touch, and the sweep of processes that name this run.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"


/** The line the engine's loop-lag watchdog writes (`senpi rpc host stall: event loop blocked 812ms ...`); its source and docs never match. */
export const LOOP_BLOCKED_LINE = /event loop blocked \d+ms/

const SKIP_DIRS = new Set(["node_modules", "runtime", "cache", ".bun", ".cache", ".npm"])
const SKIP_FILE = /\.(sqlite|sqlite-wal|sqlite-shm|db|wasm|node|png|jpg|gz|zst|tgz)$|-wal$|-shm$/

/** A sink for loop-stall hits; `hostStderrFiles` counts the host `stderr.log` files read. */
export function createLoopScan() {
  return { hits: [], filesScanned: 0, hostStderrFiles: [], streamsScanned: 0 }
}

export function scanText(scan, text, source) {
  scan.streamsScanned += 1
  if (LOOP_BLOCKED_LINE.test(text)) scan.hits.push({ source, lines: text.split(/\r?\n/).filter((line) => LOOP_BLOCKED_LINE.test(line)).slice(0, 5) })
}

/**
 * Every text file of a sandbox AGENT dir. Not walked: the engine snapshot under `runtime/`, package
 * caches, binary stores, symlinks (a snapshot links back into its own tree), files over 16 MB.
 */
export function scanTree(scan, dir, source) {
  const pending = [dir]
  while (pending.length > 0) {
    const current = pending.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) pending.push(path)
        continue
      }
      if (!entry.isFile() || SKIP_FILE.test(entry.name)) continue
      try {
        if (statSync(path).size > 16 * 1024 * 1024) continue
        const text = readFileSync(path, "utf8")
        scan.filesScanned += 1
        if (entry.name === "stderr.log" && path.includes("rpc-host-daemon")) scan.hostStderrFiles.push({ source, path, bytes: text.length })
        if (LOOP_BLOCKED_LINE.test(text)) scan.hits.push({ source, path, lines: text.split("\n").filter((line) => LOOP_BLOCKED_LINE.test(line)).slice(0, 5) })
      } catch {
        // Unreadable or vanished mid-walk.
      }
    }
  }
}

/** The whole process tree under `pid` (`ps`), RSS in KB. */
export function processTree(pid) {
  const rows = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,rss=,comm="]).stdout.toString().trim().split("\n")
  const byParent = new Map()
  const info = new Map()
  for (const row of rows) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(row)
    if (match === null) continue
    const [, child, parent, rss, comm] = match
    info.set(Number(child), { pid: Number(child), rss_kb: Number(rss), comm: comm.split("/").pop() })
    if (!byParent.has(Number(parent))) byParent.set(Number(parent), [])
    byParent.get(Number(parent)).push(Number(child))
  }
  const tree = []
  const queue = [pid]
  while (queue.length > 0) {
    const current = queue.shift()
    if (info.has(current)) tree.push(info.get(current))
    queue.push(...(byParent.get(current) ?? []))
  }
  return tree
}

/** One process's physical footprint in MB (darwin `vmmap --summary`, linux `smaps_rollup` Pss), as the shard-cost driver reads it. */
export function footprintMb(pid) {
  try {
    if (process.platform === "darwin") {
      const text = execFileSync("vmmap", ["--summary", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 })
      const match = /Physical footprint:\s+([\d.]+)([KMG])/.exec(text)
      return match === null ? undefined : Math.round(Number(match[1]) * { K: 1 / 1024, M: 1, G: 1024 }[match[2]] * 10) / 10
    }
    const match = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"))
    return match === null ? undefined : Math.round((Number(match[1]) / 1024) * 10) / 10
  } catch {
    return undefined
  }
}

/** Whole-tree RSS and physical footprint (darwin `vmmap --summary`, linux Pss), in MB. */
export function treeMemory(pid) {
  const tree = processTree(pid)
  const footprints = tree.map((entry) => ({ ...entry, footprint_mb: footprintMb(entry.pid) }))
  const measured = footprints.filter((entry) => Number.isFinite(entry.footprint_mb))
  const mb = (kb) => Math.round((kb / 1024) * 10) / 10
  return {
    tree,
    rss_mb: mb(tree.reduce((sum, entry) => sum + entry.rss_kb, 0)),
    // A process vmmap cannot read (one that exited mid-sample, a protected system helper) is named, not guessed.
    footprint_mb: measured.length === 0 ? null : Math.round(measured.reduce((sum, entry) => sum + entry.footprint_mb, 0) * 10) / 10,
    footprint_unmeasured: footprints.filter((entry) => !Number.isFinite(entry.footprint_mb)).map((entry) => `${entry.comm}:${entry.pid}`),
    processes: footprints.map((entry) => `${entry.comm}:${entry.rss_kb}KB:${entry.footprint_mb ?? "?"}MB`),
  }
}

export function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "EPERM"
  }
}

export function commandOf(pid) {
  return Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]).stdout.toString().trim()
}

/** Kill every process whose command line names `marker` (a path unique to this run). */
export function sweepMarker(marker) {
  const pids = Bun.spawnSync(["pgrep", "-f", marker]).stdout.toString().split("\n").map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Gone.
    }
  }
  return pids
}

const REAL_AGENT_DIR = join(homedir(), ".omo", "agent")

/**
 * The real agent dir, as the shard-cost driver fingerprints it. `settings.json` is not hashed (live
 * terminals rewrite it at any time); instead no top-level file of the real dir may name this run.
 */
export function realAgentFingerprint() {
  const digest = (name) => (existsSync(join(REAL_AGENT_DIR, name)) ? createHash("sha256").update(readFileSync(join(REAL_AGENT_DIR, name))).digest("hex").slice(0, 16) : "absent")
  const sock = join(REAL_AGENT_DIR, "rpc", "rpc.sock")
  return { auth: digest("auth.json"), models: digest("models.json"), rpc_sock: existsSync(sock) ? `${statSync(sock).ino}:${statSync(sock).mtimeMs}` : "absent" }
}

export function realAgentDirMentions(markers) {
  if (!existsSync(REAL_AGENT_DIR)) return []
  return readdirSync(REAL_AGENT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(json|jsonl|log)$/.test(entry.name))
    .filter((entry) => {
      try {
        const text = readFileSync(join(REAL_AGENT_DIR, entry.name), "utf8")
        return markers.some((marker) => text.includes(marker))
      } catch {
        return false
      }
    })
    .map((entry) => entry.name)
}
