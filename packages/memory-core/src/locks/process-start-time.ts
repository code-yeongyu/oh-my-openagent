// Reading the lock protocol's process-start fingerprint by spawning `/bin/ps` forks a child on every
// lock check, and a long-lived shared RPC host never reaps those children: 9,386 zombie `ps` entries
// filled the macOS process table and every posix_spawn on the machine failed with EAGAIN (#8096,
// code-yeongyu/senpi#1507). libproc answers the same question in-process, so the fork stops existing.

const PROC_PIDTBSDINFO = 3
/** sizeof(struct proc_bsdinfo) on 64-bit darwin; a short read means the flavor was rejected. */
const PROC_BSDINFO_SIZE = 136
/** Byte offset of `pbi_start_tvsec` inside struct proc_bsdinfo. */
const START_TVSEC_OFFSET = 120

type ProcPidInfo = (pid: number, flavor: number, arg: bigint, buffer: Uint8Array, size: number) => number

let procPidInfoLookup: Promise<ProcPidInfo | null> | null = null

async function openProcPidInfo(): Promise<ProcPidInfo | null> {
  if (process.platform !== "darwin") return null
  try {
    const { dlopen, FFIType } = await import("bun:ffi")
    const library = dlopen("/usr/lib/libSystem.B.dylib", {
      proc_pidinfo: {
        args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
    })
    return (pid, flavor, arg, buffer, size) => Number(library.symbols.proc_pidinfo(pid, flavor, arg, buffer, size))
  } catch {
    return null
  }
}

function loadProcPidInfo(): Promise<ProcPidInfo | null> {
  procPidInfoLookup ??= openProcPidInfo()
  return procPidInfoLookup
}

/**
 * Epoch seconds at which `pid` started, read without spawning a process, or `null` when darwin
 * cannot answer it (dead pid, pid owned by another uid, libproc unavailable).
 */
export async function readDarwinProcessStartSeconds(pid: number): Promise<number | null> {
  if (process.platform !== "darwin") return null
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  const procPidInfo = await loadProcPidInfo()
  if (procPidInfo === null) return null
  const buffer = new Uint8Array(PROC_BSDINFO_SIZE)
  let written = 0
  try {
    written = procPidInfo(pid, PROC_PIDTBSDINFO, 0n, buffer, PROC_BSDINFO_SIZE)
  } catch {
    return null
  }
  if (written !== PROC_BSDINFO_SIZE) return null
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const startSeconds = Number(view.getBigUint64(START_TVSEC_OFFSET, true))
  return startSeconds > 0 ? startSeconds : null
}
