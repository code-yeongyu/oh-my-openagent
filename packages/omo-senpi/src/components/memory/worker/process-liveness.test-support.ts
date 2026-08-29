// Bounded liveness primitives for tests that spawn real helper processes: zombie-aware pid
// probes, pid-file readers for foreign (non-child) writers, bounded child-termination waits,
// and fail-safe kills so a failed assertion can never leak a spawned process.

import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
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
export async function pidTerminalWithin(pid: number, boundMs: number): Promise<boolean> {
  const deadline = Date.now() + boundMs
  for (;;) {
    if (!pidAlive(pid)) return true
    if (Date.now() >= deadline) return false
    await Bun.sleep(10)
  }
}

/** Polls a pid file written by a foreign (non-child) helper process; throws once the bound expires. */
export async function readPidWhenWritten(path: string, boundMs: number): Promise<number> {
  const deadline = Date.now() + boundMs
  for (;;) {
    try {
      const raw = Number((await readFile(path, "utf8")).trim())
      if (Number.isInteger(raw) && raw > 0) return raw
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
    if (Date.now() >= deadline) throw new Error(`helper pid never appeared at ${path}`)
    await Bun.sleep(5)
  }
}

/** Single read of a pid file; null when absent - for helpers whose writer is already provably dead. */
export async function readPidOnce(path: string): Promise<number | null> {
  try {
    const raw = Number((await readFile(path, "utf8")).trim())
    return Number.isInteger(raw) && raw > 0 ? raw : null
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    return null
  }
}

/** SIGKILL that tolerates an already-exited target; rethrows anything else. */
export function killIfAlive(pid: number): void {
  try {
    process.kill(pid, "SIGKILL")
  } catch (error) {
    if (pidAlive(pid)) throw error
  }
}
