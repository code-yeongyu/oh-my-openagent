import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { hostname } from "node:os"

import { pidLiveness } from "../lifecycle/pid-liveness"

/**
 * Who holds a task record lock, and the proof that it is gone. A lock is removed by anyone but its
 * holder only when that holder is PROVEN dead: the pid is unknown to the kernel, or a live pid's
 * start identity contradicts the recorded one (the pid was recycled). An unknown liveness, another
 * host or an incomparable identity keeps the lock - the same policy memory-core's locks apply.
 *
 * Every read here is synchronous because `withTaskRecordLock` is: /proc on Linux, libproc and
 * kernel32 through `bun:ffi` on darwin and Windows (no process spawn per probe - #8096).
 */

export interface LockOwner {
  readonly pid: number
  /** `unavailable` when the holder could not read its own start identity, or wrote a legacy lock. */
  readonly startIdentity: string
  /** undefined for a legacy lock (written before owners carried a host); it is this host's. */
  readonly hostname: string | undefined
  readonly token: string
}

const UNAVAILABLE = "unavailable"
const OWN_IDENTITY_RETRY_FIRST_MS = 1_000
const OWN_IDENTITY_RETRY_MAX_MS = 60_000

/**
 * This process's start identity: a success is kept for the process lifetime (a live pid is never
 * reused), a failed read is retried after a doubling backoff capped at one minute, so one transient
 * failure does not leave every later lock without the identity that lets others prove this holder dead.
 */
export function createOwnStartIdentity(read: () => string | null, now: () => number): () => string {
  let known: string | undefined
  let retryAt = 0
  let backoffMs = OWN_IDENTITY_RETRY_FIRST_MS
  return () => {
    if (known !== undefined) return known
    const at = now()
    if (at < retryAt) return UNAVAILABLE
    const identity = read()
    if (identity !== null) {
      known = identity
      return identity
    }
    retryAt = at + backoffMs
    backoffMs = Math.min(backoffMs * 2, OWN_IDENTITY_RETRY_MAX_MS)
    return UNAVAILABLE
  }
}

const ownStartIdentity = createOwnStartIdentity(() => readProcessStartIdentity(process.pid), Date.now)

/** The body a holder writes: `pid`, acquisition time and token first, as every earlier build wrote them. */
export function formatLockBody(token: string): string {
  return `${process.pid}\n${Date.now()}\n${token}\n${ownStartIdentity()}\n${hostname()}\n`
}

/** undefined when the body is not a complete lock (a holder that died between create and write). */
export function parseLockOwner(body: string): LockOwner | undefined {
  const lines = body.split("\n")
  const [pidText, acquiredAt, token, startIdentity, host] = lines
  if (pidText === undefined || !/^[1-9]\d*$/.test(pidText)) return undefined
  if (acquiredAt === undefined || !/^\d+$/.test(acquiredAt)) return undefined
  if (token === undefined || token.length === 0) return undefined
  // A legacy body ends after the token; anything else must carry both owner fields.
  const legacy = lines.length === 4 && lines[3] === ""
  if (legacy) return { pid: Number(pidText), startIdentity: UNAVAILABLE, hostname: undefined, token }
  if (startIdentity === undefined || startIdentity.length === 0 || host === undefined || host.length === 0) return undefined
  return { pid: Number(pidText), startIdentity, hostname: host, token }
}

export function isLockOwnerProvenDead(owner: LockOwner): boolean {
  if (owner.hostname !== undefined && owner.hostname !== hostname()) return false
  const liveness = pidLiveness(owner.pid)
  if (liveness === "dead") return true
  if (liveness === "unknown" || owner.startIdentity === UNAVAILABLE) return false
  const actual = readProcessStartIdentity(owner.pid)
  return actual !== null && startIdentitiesConflict(owner.startIdentity, actual)
}

// Identities from different readers (schemes) are never compared: a mismatch proves death, so an
// incomparable pair must read as "no conflict" and the owner keeps its lock.
function startIdentitiesConflict(recorded: string, actual: string): boolean {
  const scheme = (identity: string): string => identity.slice(0, Math.max(0, identity.indexOf(":")))
  const recordedScheme = scheme(recorded)
  return recordedScheme.length > 0 && recordedScheme === scheme(actual) && recorded !== actual
}

export function readProcessStartIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  switch (process.platform) {
    case "linux": return readLinuxStartIdentity(pid)
    case "darwin": return readDarwinStartIdentity(pid)
    case "win32": return readWin32StartIdentity(pid)
    default: return null
  }
}

function readLinuxStartIdentity(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)
    const startTicks = fields[19]
    return startTicks === undefined ? null : `linux-proc-start-ticks:${startTicks}`
  } catch {
    return null
  }
}

type BunFfi = typeof import("bun:ffi")
let ffi: BunFfi | null | undefined

function loadFfi(): BunFfi | null {
  if (ffi !== undefined) return ffi
  try {
    ffi = process.versions.bun === undefined ? null : (createRequire(import.meta.url)("bun:ffi") as BunFfi)
  } catch {
    ffi = null
  }
  return ffi
}

const PROC_PIDTBSDINFO = 3
/** sizeof(struct proc_bsdinfo) on 64-bit darwin; a short read means the flavor was rejected. */
const PROC_BSDINFO_SIZE = 136
/** Byte offset of `pbi_start_tvsec` inside struct proc_bsdinfo. */
const START_TVSEC_OFFSET = 120
let procPidInfo: ((pid: number, buffer: Uint8Array) => number) | null | undefined

function readDarwinStartIdentity(pid: number): string | null {
  if (procPidInfo === undefined) {
    const loaded = loadFfi()
    try {
      const library = loaded?.dlopen("/usr/lib/libSystem.B.dylib", {
        proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" },
      })
      procPidInfo = library === undefined
        ? null
        : (target, buffer) => Number(library.symbols.proc_pidinfo(target, PROC_PIDTBSDINFO, 0n, buffer, PROC_BSDINFO_SIZE))
    } catch {
      procPidInfo = null
    }
  }
  if (procPidInfo === null) return null
  const buffer = new Uint8Array(PROC_BSDINFO_SIZE)
  if (procPidInfo(pid, buffer) !== PROC_BSDINFO_SIZE) return null
  const seconds = new DataView(buffer.buffer).getBigUint64(START_TVSEC_OFFSET, true)
  return seconds > 0n ? `proc-start-epoch:${seconds}` : null
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
type Kernel32 = {
  readonly OpenProcess: (access: number, inherit: number, pid: number) => unknown
  readonly GetProcessTimes: (handle: unknown, ...times: BigUint64Array[]) => number
  readonly CloseHandle: (handle: unknown) => number
}
let kernel32: Kernel32 | null | undefined

function readWin32StartIdentity(pid: number): string | null {
  if (kernel32 === undefined) {
    try {
      kernel32 = (loadFfi()?.dlopen("kernel32.dll", {
        OpenProcess: { args: ["u32", "i32", "u32"], returns: "ptr" },
        GetProcessTimes: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
        CloseHandle: { args: ["ptr"], returns: "i32" },
      }).symbols as Kernel32 | undefined) ?? null
    } catch {
      kernel32 = null
    }
  }
  if (kernel32 === null) return null
  const handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
  if (handle === null || handle === 0 || handle === 0n) return null
  try {
    const creation = new BigUint64Array(1)
    const ok = kernel32.GetProcessTimes(handle, creation, new BigUint64Array(1), new BigUint64Array(1), new BigUint64Array(1))
    const filetime = creation[0] ?? 0n
    return ok === 0 || filetime === 0n ? null : `win32-creation-filetime:${filetime}`
  } finally {
    kernel32.CloseHandle(handle)
  }
}
