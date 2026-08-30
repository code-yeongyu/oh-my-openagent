// Bounded liveness primitives for tests that spawn real helper processes: zombie-aware pid
// probes, pid-file readers for foreign (non-child) writers, bounded child-termination waits,
// and fail-safe kills so a failed assertion can never leak a spawned process.

import { existsSync, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import type { ChildProcess } from "node:child_process"

/**
 * Resolves true once the child TERMINATED (`exit`, or the later `close`), false once `boundMs`
 * elapsed. Deliberately NOT gated on stdio close alone: `close` lags `exit` indefinitely when a
 * descendant inherited the child's stdio fds, and teardown must never stall - or report a false
 * "survived teardown" - behind pipes that carry no liveness of their own.
 */
export function exitedWithin(child: ChildProcess, boundMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(false), boundMs)
    function settle(exited: boolean): void {
      clearTimeout(timer)
      child.off("exit", onDone)
      child.off("close", onDone)
      resolve(exited)
    }
    function onDone(): void {
      settle(true)
    }
    child.once("exit", onDone)
    child.once("close", onDone)
  })
}

export function pidAlive(pid: number): boolean {
  if (process.platform === "linux") {
    try {
      const statLine = readFileSync(`/proc/${String(pid)}/stat`, "utf8")
      const stateIndex = statLine.lastIndexOf(")") + 2
      // Z = zombie: exited but unreaped; signal liveness still succeeds against it.
      if (statLine.slice(stateIndex, stateIndex + 1) === "Z") return false
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
      // Unreadable /proc entry: fall through to signal liveness.
    }
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH means the process is gone; anything else (EPERM, ...) means it still exists.
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    return true
  }
}

/** Resolves true once the pid is provably terminal (dead or zombie), false once `boundMs` elapsed. */
export type ProcessIdentity = Readonly<{ pid: number; command: string }>

function commandForPid(pid: number): string | null {
  try {
    if (process.platform === "linux") return readFileSync(`/proc/${String(pid)}/cmdline`, "utf8").replaceAll("\\0", " ").trim()
    if (process.platform === "win32") {
      const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}").CommandLine`], { encoding: "utf8" }).trim()
      return out === "" ? null : out
    }
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}

/** Snapshots a live process's command identity; null when the pid is gone or unreadable. */
export function captureIdentity(pid: number): ProcessIdentity | null {
  const command = commandForPid(pid)
  return command === null ? null : { pid, command }
}

export function identityMatches(identity: ProcessIdentity): boolean {
  const command = commandForPid(identity.pid)
  return command !== null && command === identity.command
}

export function pidTerminalWithin(identity: ProcessIdentity, boundMs: number): Promise<boolean> {
  // Watching /proc/<pid> cannot detect termination: a zombie keeps its /proc entry present (and
  // procfs does not deliver reliable fs events), so a watcher can sleep through the death it
  // waits for. The zombie-aware liveness probe is the only correct oracle on every platform.
  return probeUntil(() => !identityMatches(identity) || !pidAlive(identity.pid), boundMs)
}

/**
 * Bounded condition probe: resolves true once `condition` holds, false once `boundMs` elapsed.
 * This is the sanctioned fallback for waiting on FOREIGN processes/files, where no OS-level
 * event exists (fs.watch is unreliable on some platforms - events can arrive late or never).
 * It is never an ordering oracle: callers assert on the condition outcome, not on elapsed time.
 */
export async function probeUntil(condition: () => boolean | Promise<boolean>, boundMs: number, intervalMs = 25): Promise<boolean> {
  const deadline = Date.now() + boundMs
  for (;;) {
    if (await condition()) return true
    if (Date.now() >= deadline) return false
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** Waits until a file exists (bounded probe; see probeUntil). */
export function waitForFileToExist(path: string, boundMs: number): Promise<boolean> {
  return probeUntil(() => existsSync(path), boundMs)
}

/** Reads a pid file written by a foreign helper once it appears, without requiring the process to still be alive. */
export async function readPidFileWhenWritten(path: string, boundMs: number): Promise<number> {
  let pid: number | null = null
  const found = await probeUntil(async () => {
    try {
      const raw = Number((await readFile(path, "utf8")).trim())
      if (Number.isInteger(raw) && raw > 0) {
        pid = raw
        return true
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
    return false
  }, boundMs)
  if (!found || pid === null) throw new Error(`pid file never appeared: ${path}`)
  return pid
}

/** Reads a pid file written by a foreign helper and snapshots its command identity. */
export async function readPidWhenWritten(path: string, boundMs: number, expectedCommand?: string): Promise<ProcessIdentity> {
  let identity: ProcessIdentity | null = null
  const found = await probeUntil(() => {
    let raw: number
    try {
      raw = Number(readFileSync(path, "utf8").trim())
    } catch {
      return false
    }
    if (!Number.isInteger(raw) || raw <= 0) return false
    const command = commandForPid(raw)
    if (command === null || (expectedCommand !== undefined && !command.includes(expectedCommand))) return false
    identity = { pid: raw, command }
    return true
  }, boundMs)
  if (!found || identity === null) throw new Error(`helper pid never appeared at ${path}`)
  return identity
}

/** Single identity read; null when absent or the process no longer matches. */
export async function readPidOnce(path: string, expectedCommand?: string): Promise<ProcessIdentity | null> {
  try {
    const raw = Number((await readFile(path, "utf8")).trim())
    if (!Number.isInteger(raw) || raw <= 0) return null
    const command = commandForPid(raw)
    return command !== null && (expectedCommand === undefined || command.includes(expectedCommand)) ? { pid: raw, command } : null
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    return null
  }
}

/** SIGKILL only when the target still has the command identity captured at registration. */
export function killIfAlive(identity: ProcessIdentity): void {
  if (!identityMatches(identity)) return
  try {
    process.kill(identity.pid, "SIGKILL")
  } catch (error) {
    if (pidAlive(identity.pid)) throw error
  }
}
