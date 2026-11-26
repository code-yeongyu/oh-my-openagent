import { readlink } from "node:fs/promises"

import { getPidLiveness, getProcessStartIdentity } from "@oh-my-opencode/memory-core/process-identity"
import { readRecoveryClock } from "../recovery-clock"

// Who started a custody operation or holds the custody lock, read the one way both use (security design 8.2, decision
// D22-17): the process's start identity and the process-number space its pid belongs to. A reader calls a process gone
// only inside its own space; a pid from another space (a home shared by hosts or containers) proves nothing here.

/** The start identity of `pid`: the boot it started in, then its start time; null when it cannot be read. */
export async function processStart(pid: number): Promise<string | null> {
  const [clock, start] = await Promise.all([readRecoveryClock(), getProcessStartIdentity(pid)])
  return clock === null || start === null ? null : `${clock.bootId}:${start}`
}

async function readScope(): Promise<string | null> {
  const clock = await readRecoveryClock()
  if (clock === null) return null
  if (process.platform !== "linux") return clock.bootId
  const namespace = await readlink("/proc/self/ns/pid").catch(() => undefined)
  const inode = namespace === undefined ? undefined : /\[(\d+)\]/.exec(namespace)?.[1]
  return inode === undefined ? null : `${clock.bootId}:pid-ns:${inode}`
}

let ownScope: Promise<string | null> | undefined
/** The process-number space of this process: on Linux the boot and the pid namespace, on macOS the boot session. */
export const processScope = (): Promise<string | null> => (ownScope ??= readScope())

/** A process named by a record: its pid, and (written since D22-17) its start identity and scope. */
export type NamedProcess = { readonly pid: number; readonly start?: string | null; readonly scope?: string | null }

/**
 * Whether `named` is provably gone: "gone" when its scope is this reader's and its pid is absent or now names a process
 * that started at another time; "elsewhere" when it was written in another scope, which this reader cannot judge; else
 * "alive". A record from before D22-17 (no scope) keeps the pid-only reading.
 */
export async function processState(named: NamedProcess): Promise<"gone" | "alive" | "elsewhere"> {
  if (named.scope !== undefined && named.scope !== null) {
    const own = await processScope()
    if (own === null || own !== named.scope) return "elsewhere"
  }
  if (getPidLiveness(named.pid) === "dead") return "gone"
  if (named.start === undefined || named.start === null) return "alive"
  const now = await processStart(named.pid)
  return now !== null && now !== named.start ? "gone" : "alive"
}
