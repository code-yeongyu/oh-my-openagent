// The test's view of Windows job objects and processes (design v4.2 rows T1, T6, T7, T8), through kernel32 directly.
// Test-only: production Bun code keeps exactly the gate's CreateFileW and CloseHandle (section 3). Every handle opened
// here is closed in the same call unless it is returned to the caller, who closes it.
import { dlopen, FFIType } from "bun:ffi"

import { probeUntil } from "../locks/process-liveness.test-support"

const INVALID_HANDLE = 0xffff_ffff_ffff_ffffn
const JOB_OBJECT_QUERY = 0x0004
const PROCESS_TERMINATE = 0x0001
const PROCESS_SET_QUOTA = 0x0100
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const SYNCHRONIZE = 0x0010_0000
const JOB_BASIC_ACCOUNTING = 1
const JOB_BASIC_PROCESS_ID_LIST = 3
const JOB_ASSOCIATE_COMPLETION_PORT = 7
const TH32CS_SNAPPROCESS = 0x2
const PROCESSENTRY32W_SIZE = 568
const WAIT_OBJECT_0 = 0

export const JOB_MSG_NEW_PROCESS = 6
export const JOB_MSG_EXIT_PROCESS = 7
export const JOB_MSG_ABNORMAL_EXIT_PROCESS = 8

const { u64, u32, i32, ptr } = FFIType
let kernel32: ReturnType<typeof load> | undefined

function load() {
  return dlopen("kernel32.dll", {
    OpenJobObjectW: { args: [u32, i32, ptr], returns: u64 },
    QueryInformationJobObject: { args: [u64, i32, ptr, u32, ptr], returns: i32 },
    OpenProcess: { args: [u32, i32, u32], returns: u64 },
    IsProcessInJob: { args: [u64, u64, ptr], returns: i32 },
    QueryFullProcessImageNameW: { args: [u64, u32, ptr, ptr], returns: i32 },
    CreateToolhelp32Snapshot: { args: [u32, u32], returns: u64 },
    Process32FirstW: { args: [u64, ptr], returns: i32 },
    Process32NextW: { args: [u64, ptr], returns: i32 },
    WaitForSingleObject: { args: [u64, u32], returns: u32 },
    GetExitCodeProcess: { args: [u64, ptr], returns: i32 },
    CloseHandle: { args: [u64], returns: i32 },
    CreateJobObjectW: { args: [ptr, ptr], returns: u64 },
    CreateIoCompletionPort: { args: [u64, u64, u64, u32], returns: u64 },
    SetInformationJobObject: { args: [u64, i32, ptr, u32], returns: i32 },
    AssignProcessToJobObject: { args: [u64, u64], returns: i32 },
    GetQueuedCompletionStatus: { args: [u64, ptr, ptr, ptr, u32], returns: i32 },
    TerminateJobObject: { args: [u64, u32], returns: i32 },
  }).symbols
}

function k32() {
  kernel32 ??= load()
  return kernel32
}

function wide(text: string): Buffer {
  return Buffer.from(`${text}\0`, "utf16le")
}

function valid(handle: bigint): bigint | null {
  return handle === 0n || handle === INVALID_HANDLE ? null : handle
}

export function closeHandle(handle: bigint): void {
  k32().CloseHandle(handle)
}

export function openJobForQuery(name: string): bigint | null {
  return valid(k32().OpenJobObjectW(JOB_OBJECT_QUERY, 0, wide(name)))
}

export function jobActiveProcesses(job: bigint): number {
  const info = new BigUint64Array(6)
  if (k32().QueryInformationJobObject(job, JOB_BASIC_ACCOUNTING, info, 48, null) === 0) throw new Error("job accounting query failed")
  return new DataView(info.buffer).getUint32(40, true)
}

export function jobProcessIds(job: bigint): number[] {
  const list = new BigUint64Array(1 + 256)
  if (k32().QueryInformationJobObject(job, JOB_BASIC_PROCESS_ID_LIST, list, list.byteLength, null) === 0) throw new Error("job pid list query failed")
  const listed = new DataView(list.buffer).getUint32(4, true)
  return Array.from(list.slice(1, 1 + listed), Number)
}

function withProcess<T>(pid: number, access: number, use: (handle: bigint) => T): T | null {
  const handle = valid(k32().OpenProcess(access, 0, pid))
  if (handle === null) return null
  try {
    return use(handle)
  } finally {
    closeHandle(handle)
  }
}

export function isProcessInJob(pid: number, job: bigint): boolean | null {
  return withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION, (handle) => {
    const result = new Int32Array(1)
    return k32().IsProcessInJob(handle, job, result) === 0 ? null : result[0] !== 0
  })
}

export function processImage(pid: number): string | null {
  return withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION, (handle) => {
    const buffer = new Uint16Array(1024)
    const size = new Uint32Array([buffer.length])
    if (k32().QueryFullProcessImageNameW(handle, 0, buffer, size) === 0) return null
    return Buffer.from(buffer.buffer, 0, (size[0] ?? 0) * 2).toString("utf16le")
  })
}

export function parentPids(): Map<number, number> {
  const snapshot = valid(k32().CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0))
  if (snapshot === null) throw new Error("CreateToolhelp32Snapshot failed")
  const parents = new Map<number, number>()
  try {
    const entry = new Uint8Array(PROCESSENTRY32W_SIZE)
    const view = new DataView(entry.buffer)
    view.setUint32(0, PROCESSENTRY32W_SIZE, true)
    let more = k32().Process32FirstW(snapshot, entry) !== 0
    while (more) {
      parents.set(view.getUint32(8, true), view.getUint32(32, true))
      more = k32().Process32NextW(snapshot, entry) !== 0
    }
  } finally {
    closeHandle(snapshot)
  }
  return parents
}

export function watchProcess(pid: number): bigint | null {
  return valid(k32().OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid))
}

export function isSignaled(process: bigint): boolean {
  return k32().WaitForSingleObject(process, 0) === WAIT_OBJECT_0
}

export function signaledWithin(process: bigint, boundMs: number): Promise<boolean> {
  return probeUntil(() => isSignaled(process), boundMs)
}

export function exitCodeOf(process: bigint): number | null {
  const code = new Uint32Array(1)
  return k32().GetExitCodeProcess(process, code) === 0 ? null : (code[0] ?? null)
}

export type JobMessage = { readonly message: number; readonly pid: number }

/** An unnamed job with a completion port: the test-owned outer job of rows T7(c), T7(d) and T8. */
export class OuterJob {
  private constructor(readonly job: bigint, private readonly port: bigint) {}

  static create(): OuterJob {
    const job = valid(k32().CreateJobObjectW(null, null))
    if (job === null) throw new Error("CreateJobObjectW failed")
    const port = valid(k32().CreateIoCompletionPort(INVALID_HANDLE, 0n, 0n, 1))
    if (port === null) throw new Error("CreateIoCompletionPort failed")
    const association = new BigUint64Array([1n, port])
    if (k32().SetInformationJobObject(job, JOB_ASSOCIATE_COMPLETION_PORT, association, 16) === 0) throw new Error("port association failed")
    return new OuterJob(job, port)
  }

  assign(pid: number): void {
    const assigned = withProcess(pid, PROCESS_SET_QUOTA | PROCESS_TERMINATE, (handle) => k32().AssignProcessToJobObject(this.job, handle) !== 0)
    if (assigned !== true) throw new Error(`AssignProcessToJobObject failed for pid ${pid}`)
  }

  /** The next job message matching `accept`, read with zero-timeout dequeues so the event loop keeps running. */
  async next(accept: (message: JobMessage) => boolean, boundMs: number): Promise<JobMessage> {
    const bytes = new Uint32Array(1)
    const key = new BigUint64Array(1)
    const overlapped = new BigUint64Array(1)
    let found: JobMessage | undefined
    const arrived = await probeUntil(() => {
      while (k32().GetQueuedCompletionStatus(this.port, bytes, key, overlapped, 0) !== 0) {
        const message = { message: bytes[0] ?? 0, pid: Number(overlapped[0] ?? 0n) }
        if (accept(message)) {
          found = message
          return true
        }
      }
      return false
    }, boundMs, 10)
    if (!arrived || found === undefined) throw new Error(`no matching job message within ${boundMs} ms`)
    return found
  }

  close(): void {
    k32().TerminateJobObject(this.job, 1)
    closeHandle(this.job)
    closeHandle(this.port)
  }
}
