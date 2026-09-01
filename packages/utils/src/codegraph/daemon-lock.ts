import { readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/**
 * Daemon pid lockfile handling for the zombie sweep's staleness gate.
 *
 * Empirically verified against the real 1.4.1 binary: a detached
 * `codegraph serve --mcp --path <root>` daemon resolves its daemon root to the
 * nearest initialized ancestor of `--path` (a directory holding
 * `.codegraph/codegraph.db`, realpath'd) and writes
 * `<daemonRoot>/.codegraph/daemon.pid` with a JSON body:
 *
 *   { "pid": 44375, "version": "1.4.1", "socketPath": "...", "startedAt": 1784615252733 }
 *
 * Older builds wrote a plain decimal pid; both formats parse here.
 *
 * The gate is conservative by default: a daemon-shaped process is provably
 * stale ONLY when no lockfile anywhere along the `--path` ancestor chain
 * records its pid. Any ambiguity (unreadable or unparseable lock) spares the
 * process and logs.
 */

export interface CodegraphDaemonLock {
  readonly pid: number
  readonly socketPath?: string
  readonly startedAt?: number
  readonly version?: string
}

export type CodegraphDaemonStaleness =
  | { readonly stale: true; readonly reason: "lock-absent" | "lock-pid-mismatch" }
  | { readonly stale: false; readonly reason: "lock-pid-match" | "lock-unparseable" | "lock-unreadable" }

export function parseDaemonLock(raw: string): CodegraphDaemonLock | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === "object" && parsed !== null && "pid" in parsed) {
      const pid = (parsed as { readonly pid: unknown }).pid
      if (typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0) {
        const record = parsed as Record<string, unknown>
        return {
          pid,
          ...(typeof record["socketPath"] === "string" ? { socketPath: record["socketPath"] } : {}),
          ...(typeof record["startedAt"] === "number" ? { startedAt: record["startedAt"] } : {}),
          ...(typeof record["version"] === "string" ? { version: record["version"] } : {}),
        }
      }
    }
    return null
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  const legacyPid = Number(trimmed)
  if (Number.isSafeInteger(legacyPid) && legacyPid > 0) return { pid: legacyPid }
  return null
}

/**
 * Every lockfile path that could belong to a daemon started with
 * `--path <projectRoot>`: `<dir>/.codegraph/daemon.pid` for the resolved root,
 * its realpath, and every ancestor of both (the daemon walks up to the nearest
 * initialized project root, e.g. `/tmp/x` when `/tmp` itself is initialized).
 */
export function daemonLockCandidates(projectRoot: string): string[] {
  const dirs = new Set<string>()
  const resolved = resolve(projectRoot)
  collectAncestors(resolved, dirs)
  collectAncestors(realpathIfPossible(resolved), dirs)
  return [...dirs].map((dir) => join(dir, ".codegraph", "daemon.pid"))
}

export function evaluateDaemonStaleness(pid: number, projectRoot: string): CodegraphDaemonStaleness {
  let sawLock = false
  for (const lockPath of daemonLockCandidates(projectRoot)) {
    const raw = readLockIfPresent(lockPath)
    if (raw === undefined) continue
    if (raw === null) return { stale: false, reason: "lock-unreadable" }
    sawLock = true
    const lock = parseDaemonLock(raw)
    if (lock === null) return { stale: false, reason: "lock-unparseable" }
    if (lock.pid === pid) return { stale: false, reason: "lock-pid-match" }
  }
  return sawLock
    ? { stale: true, reason: "lock-pid-mismatch" }
    : { stale: true, reason: "lock-absent" }
}

/** Returns the lock body, undefined when absent, or null when unreadable. */
function readLockIfPresent(lockPath: string): string | null | undefined {
  try {
    return readFileSync(lockPath, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    if (error instanceof Error && "code" in error && error.code === "ENOTDIR") return undefined
    return null
  }
}

function collectAncestors(start: string, output: Set<string>): void {
  let current = start
  for (;;) {
    output.add(current)
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

function realpathIfPossible(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    if (error instanceof Error) return path
    throw error
  }
}
