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

// Windows used to answer the same question by spawning `powershell.exe Get-Process` under a 2 s
// execFile budget. On a loaded runner PowerShell start-up alone crosses that budget, every probe is
// killed and reports null, and a null own identity is deliberately never memoized - so every lock
// record creation paid the full 2 s and the two-process takeover test starved (#8294). kernel32's
// GetProcessTimes answers in-process in microseconds for our own pid and for foreign owners alike.

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

type ProcessHandle = import("bun:ffi").Pointer | bigint

type Kernel32ProcessTimes = {
  readonly OpenProcess: (access: number, inheritHandle: number, pid: number) => ProcessHandle | null
  readonly GetProcessTimes: (
    handle: ProcessHandle,
    creation: BigUint64Array,
    exit: BigUint64Array,
    kernel: BigUint64Array,
    user: BigUint64Array,
  ) => number
  readonly CloseHandle: (handle: ProcessHandle) => number
}

let kernel32Lookup: Promise<Kernel32ProcessTimes | null> | null = null

async function openKernel32(): Promise<Kernel32ProcessTimes | null> {
  if (process.platform !== "win32") return null
  try {
    const { dlopen, FFIType } = await import("bun:ffi")
    const library = dlopen("kernel32.dll", {
      OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
      GetProcessTimes: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
    })
    return library.symbols
  } catch {
    return null
  }
}

/**
 * FILETIME (100 ns ticks since 1601-01-01 UTC) at which `pid` was created, read without spawning a
 * process, or `null` when win32 cannot answer it (dead pid, inaccessible process, FFI unavailable).
 */
export async function readWin32ProcessCreationFiletime(pid: number): Promise<bigint | null> {
  if (process.platform !== "win32") return null
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  kernel32Lookup ??= openKernel32()
  const kernel32 = await kernel32Lookup
  if (kernel32 === null) return null
  const handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
  if (handle === null || handle === 0 || handle === 0n) return null
  try {
    const creation = new BigUint64Array(1)
    const ok = kernel32.GetProcessTimes(handle, creation, new BigUint64Array(1), new BigUint64Array(1), new BigUint64Array(1))
    const filetime = creation[0] ?? 0n
    return ok === 0 || filetime === 0n ? null : filetime
  } finally {
    kernel32.CloseHandle(handle)
  }
}
