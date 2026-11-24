import { readdirSync, readFileSync } from "node:fs"
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
  /** Fills `buffer` with every live pid; answers how many it wrote. */
  readonly listAllPids: (buffer: Int32Array) => number
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
      proc_listallpids: { args: ["ptr", "i32"], returns: "i32" },
    })
    const timebase = new Uint32Array(2)
    if (library === undefined || library.symbols.mach_timebase_info(timebase) !== 0 || !timebase[1]) {
      libSystem = null
      return libSystem
    }
    libSystem = {
      procPidInfo: (target, kind, buffer) =>
        Number(library.symbols.proc_pidinfo(target, kind, 0n, buffer, buffer.length)),
      listAllPids: (buffer) => Number(library.symbols.proc_listallpids(buffer, buffer.byteLength)),
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
  readonly CreateToolhelp32Snapshot: (flags: number, pid: number) => unknown
  readonly Process32FirstW: (snapshot: unknown, entry: Uint8Array) => number
  readonly Process32NextW: (snapshot: unknown, entry: Uint8Array) => number
}
let kernel32: Kernel32 | null | undefined

function loadKernel32(): Kernel32 | null {
  if (kernel32 !== undefined) return kernel32
  try {
    kernel32 =
      (loadFfi()?.dlopen("kernel32.dll", {
        OpenProcess: { args: ["u32", "i32", "u32"], returns: "ptr" },
        GetProcessTimes: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
        CloseHandle: { args: ["ptr"], returns: "i32" },
        CreateToolhelp32Snapshot: { args: ["u32", "u32"], returns: "ptr" },
        Process32FirstW: { args: ["ptr", "ptr"], returns: "i32" },
        Process32NextW: { args: ["ptr", "ptr"], returns: "i32" },
      }).symbols as Kernel32 | undefined) ?? null
  } catch {
    kernel32 = null
  }
  return kernel32
}

/** FILETIME values in 100 ns units: creation, exit, kernel and user time. */
function win32ProcessTimes(
  pid: number,
): { readonly creation: bigint; readonly kernel: bigint; readonly user: bigint } | null {
  const kernel32 = loadKernel32()
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
/** `_SC_CLK_TCK` on Linux (glibc and musl). */
const SC_CLK_TCK = 2
/** USER_HZ every mainstream Linux kernel uses; only the answer when the system value cannot be read. */
const FALLBACK_LINUX_CLK_TCK = 100
let linuxClockTicksPerSecond: number | undefined

/** Linux clock ticks per second for /proc utime/stime, read once from sysconf(_SC_CLK_TCK). */
function linuxClockTicks(): number {
  if (linuxClockTicksPerSecond !== undefined) return linuxClockTicksPerSecond
  linuxClockTicksPerSecond = FALLBACK_LINUX_CLK_TCK
  for (const libc of ["libc.so.6", `libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`]) {
    try {
      const ticks = Number(
        loadFfi()
          ?.dlopen(libc, { sysconf: { args: ["i32"], returns: "i64" } })
          .symbols.sysconf(SC_CLK_TCK),
      )
      if (Number.isSafeInteger(ticks) && ticks > 0) {
        linuxClockTicksPerSecond = ticks
        break
      }
    } catch {
      continue
    }
  }
  return linuxClockTicksPerSecond
}

/** User plus system CPU seconds the process itself has used, or null when it cannot be read. */
export function readProcessCpuSeconds(pid: number): number | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  switch (process.platform) {
    case "linux": {
      const fields = linuxStatFields(pid)
      if (fields === null) return null
      const ticks = Number(fields[11]) + Number(fields[12])
      return Number.isFinite(ticks) ? ticks / linuxClockTicks() : null
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

/** Byte offset of `pbi_ppid` inside struct proc_bsdinfo. */
const PPID_OFFSET = 16
const TH32CS_SNAPPROCESS = 0x2
/** sizeof(PROCESSENTRY32W) on 64-bit Windows, and the offsets of th32ProcessID and th32ParentProcessID in it. */
const PROCESSENTRY32W_SIZE = 568
const ENTRY_PID_OFFSET = 8
const ENTRY_PARENT_PID_OFFSET = 32

/** Every live process's parent pid, or null when the process table cannot be read. */
function parentPids(): Map<number, number> | null {
  const parents = new Map<number, number>()
  switch (process.platform) {
    case "linux": {
      let entries: string[]
      try {
        entries = readdirSync("/proc")
      } catch {
        return null
      }
      for (const entry of entries) {
        if (!/^\d+$/.test(entry)) continue
        const parent = Number(linuxStatFields(Number(entry))?.[1])
        if (Number.isSafeInteger(parent)) parents.set(Number(entry), parent)
      }
      return parents
    }
    case "darwin": {
      const library = loadLibSystem()
      if (library === null) return null
      const pids = new Int32Array(8192)
      const count = Math.min(library.listAllPids(pids), pids.length)
      if (count <= 0) return null
      for (const pid of pids.subarray(0, count)) {
        const info = pid > 0 ? darwinPidInfo(pid, PROC_PIDTBSDINFO, PROC_BSDINFO_SIZE) : null
        if (info !== null) parents.set(pid, info.getUint32(PPID_OFFSET, true))
      }
      return parents
    }
    case "win32": {
      const kernel32 = loadKernel32()
      if (kernel32 === null) return null
      const snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
      if (snapshot === null || snapshot === 0 || snapshot === 0n) return null
      try {
        const entry = new Uint8Array(PROCESSENTRY32W_SIZE)
        const view = new DataView(entry.buffer)
        view.setUint32(0, PROCESSENTRY32W_SIZE, true)
        for (
          let more = kernel32.Process32FirstW(snapshot, entry);
          more !== 0;
          more = kernel32.Process32NextW(snapshot, entry)
        ) {
          parents.set(view.getUint32(ENTRY_PID_OFFSET, true), view.getUint32(ENTRY_PARENT_PID_OFFSET, true))
        }
      } finally {
        kernel32.CloseHandle(snapshot)
      }
      return parents.size === 0 ? null : parents
    }
    default:
      return null
  }
}

/**
 * CPU seconds of the process rooted at `pid` plus every live descendant, or null when the root cannot be read. A
 * launcher that spawns the real engine as its own child (an npm shim, a wrapper script) stays CPU-flat while the
 * engine works, so a progress bound on the launcher alone would call a booting engine stalled (#14820).
 */
export function readProcessTreeCpuSeconds(pid: number): number | null {
  const root = readProcessCpuSeconds(pid)
  if (root === null) return null
  const parents = parentPids()
  if (parents === null) return root
  const children = new Map<number, number[]>()
  for (const [child, parent] of parents) {
    if (child === parent) continue
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [child])
    else siblings.push(child)
  }
  let total = root
  const seen = new Set([pid])
  const pending = [...(children.get(pid) ?? [])]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue
    seen.add(next)
    total += readProcessCpuSeconds(next) ?? 0
    pending.push(...(children.get(next) ?? []))
  }
  return total
}
