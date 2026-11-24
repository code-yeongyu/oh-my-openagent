import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

/**
 * Synchronous reads of another process's kernel facts, with no process spawn per probe (#8096): /proc on Linux,
 * libproc on darwin and kernel32 on Windows, the last two through `bun:ffi`. Every reader answers null when the
 * fact cannot be read (another runtime, a gone pid, a refused handle), never a guess.
 */

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

function linuxStatFields(pid: number): readonly string[] | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    return stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/)
  } catch {
    return null
  }
}

type LibSystem = {
  readonly procPidInfo: (pid: number, flavor: number, buffer: Uint8Array) => number
  /** Nanoseconds per Mach absolute-time tick: 1 on Intel, 125/3 on Apple Silicon. */
  readonly nanosecondsPerTick: number
}
let libSystem: LibSystem | null | undefined

function loadLibSystem(): LibSystem | null {
  if (libSystem !== undefined) return libSystem
  try {
    const library = loadFfi()?.dlopen("/usr/lib/libSystem.B.dylib", {
      proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" },
      mach_timebase_info: { args: ["ptr"], returns: "i32" },
    })
    const timebase = new Uint32Array(2)
    if (library === undefined || library.symbols.mach_timebase_info(timebase) !== 0 || !timebase[1]) {
      libSystem = null
      return libSystem
    }
    libSystem = {
      procPidInfo: (target, kind, buffer) =>
        Number(library.symbols.proc_pidinfo(target, kind, 0n, buffer, buffer.length)),
      nanosecondsPerTick: (timebase[0] ?? 0) / timebase[1],
    }
  } catch {
    libSystem = null
  }
  return libSystem
}

function darwinPidInfo(pid: number, flavor: number, size: number): DataView | null {
  const procPidInfo = loadLibSystem()?.procPidInfo
  if (procPidInfo === undefined) return null
  const buffer = new Uint8Array(size)
  // A short read means the flavor was rejected or the pid is gone.
  return procPidInfo(pid, flavor, buffer) === size ? new DataView(buffer.buffer) : null
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
type Kernel32 = {
  readonly OpenProcess: (access: number, inherit: number, pid: number) => unknown
  readonly GetProcessTimes: (handle: unknown, ...times: BigUint64Array[]) => number
  readonly CloseHandle: (handle: unknown) => number
}
let kernel32: Kernel32 | null | undefined

/** FILETIME values in 100 ns units: creation, exit, kernel and user time. */
function win32ProcessTimes(
  pid: number,
): { readonly creation: bigint; readonly kernel: bigint; readonly user: bigint } | null {
  if (kernel32 === undefined) {
    try {
      kernel32 =
        (loadFfi()?.dlopen("kernel32.dll", {
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
    const [creation, exit, kernel, user] = [1, 2, 3, 4].map(() => new BigUint64Array(1))
    if (kernel32.GetProcessTimes(handle, creation, exit, kernel, user) === 0) return null
    return { creation: creation[0] ?? 0n, kernel: kernel[0] ?? 0n, user: user[0] ?? 0n }
  } finally {
    kernel32.CloseHandle(handle)
  }
}

const PROC_PIDTBSDINFO = 3
/** sizeof(struct proc_bsdinfo) on 64-bit darwin. */
const PROC_BSDINFO_SIZE = 136
/** Byte offset of `pbi_start_tvsec` inside struct proc_bsdinfo. */
const START_TVSEC_OFFSET = 120

/** A start identity that changes when a pid is reused, or null when it cannot be read. */
export function readProcessStartIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  switch (process.platform) {
    case "linux": {
      const startTicks = linuxStatFields(pid)?.[19]
      return startTicks === undefined ? null : `linux-proc-start-ticks:${startTicks}`
    }
    case "darwin": {
      const seconds = darwinPidInfo(pid, PROC_PIDTBSDINFO, PROC_BSDINFO_SIZE)?.getBigUint64(START_TVSEC_OFFSET, true)
      return seconds === undefined || seconds === 0n ? null : `proc-start-epoch:${seconds}`
    }
    case "win32": {
      const creation = win32ProcessTimes(pid)?.creation
      return creation === undefined || creation === 0n ? null : `win32-creation-filetime:${creation}`
    }
    default:
      return null
  }
}

const PROC_PIDTASKINFO = 4
/** sizeof(struct proc_taskinfo) on 64-bit darwin. */
const PROC_TASKINFO_SIZE = 96
/**
 * Byte offsets of `pti_total_user` and `pti_total_system` inside struct proc_taskinfo. They count Mach absolute-time
 * ticks, which are nanoseconds only on Intel; Apple Silicon ticks are 125/3 ns, so they are scaled by the timebase.
 */
const TOTAL_USER_OFFSET = 16
const TOTAL_SYSTEM_OFFSET = 24
/** Linux clock ticks per second for utime/stime; 100 on every kernel these tests and users run. */
const LINUX_CLK_TCK = 100

/** User plus system CPU seconds the process itself has used, or null when it cannot be read. */
export function readProcessCpuSeconds(pid: number): number | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  switch (process.platform) {
    case "linux": {
      const fields = linuxStatFields(pid)
      if (fields === null) return null
      const ticks = Number(fields[11]) + Number(fields[12])
      return Number.isFinite(ticks) ? ticks / LINUX_CLK_TCK : null
    }
    case "darwin": {
      const info = darwinPidInfo(pid, PROC_PIDTASKINFO, PROC_TASKINFO_SIZE)
      const nanosecondsPerTick = loadLibSystem()?.nanosecondsPerTick
      if (info === null || nanosecondsPerTick === undefined) return null
      const ticks = info.getBigUint64(TOTAL_USER_OFFSET, true) + info.getBigUint64(TOTAL_SYSTEM_OFFSET, true)
      return (Number(ticks) * nanosecondsPerTick) / 1e9
    }
    case "win32": {
      const times = win32ProcessTimes(pid)
      return times === null ? null : Number(times.kernel + times.user) / 1e7
    }
    default:
      return null
  }
}
