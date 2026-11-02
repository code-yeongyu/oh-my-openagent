import { join } from "node:path"

import { GIT_ACTIVITY_SHARED_WAIT_MS } from "./git-activity-lock"

// The Windows admission gate (design v4.2 section 6.4): `<locks>\git-activity.gate` opened with share mode 0, so one
// holder per machine, plus an in-process async mutex in front of it so two async paths of one process never
// interleave. A STARTED entry is written and deleted only under it; the reclaimer probes under it. Not `*.lock`, so
// the dead-owner sweep never parses it. The handle is not inheritable and closes when its process dies. A failed open
// is "not acquired": no decision here reads a Win32 last-error value (section 3).
const GIT_ACTIVITY_GATE_NAME = "git-activity.gate"

const GENERIC_READ_WRITE = 0xc000_0000
const OPEN_ALWAYS = 4
const FILE_ATTRIBUTE_NORMAL = 0x80
const INVALID_HANDLE = 0xffff_ffff_ffff_ffffn
const RETRY_MS = 5

type GateApi = {
  readonly open: (path: Buffer) => bigint
  readonly close: (handle: bigint) => void
}

let gateApi: Promise<GateApi | null> | undefined

async function loadGateApi(): Promise<GateApi | null> {
  if (process.platform !== "win32") return null
  try {
    const { dlopen, FFIType } = await import("bun:ffi")
    const { u32, u64, ptr } = FFIType
    const { symbols } = dlopen("kernel32.dll", {
      CreateFileW: { args: [ptr, u32, u32, ptr, u32, u32, ptr], returns: u64 },
      CloseHandle: { args: [u64], returns: FFIType.i32 },
    })
    return {
      open: (path) => BigInt(symbols.CreateFileW(path, GENERIC_READ_WRITE, 0, null, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, null)),
      close: (handle) => void symbols.CloseHandle(handle),
    }
  } catch {
    return null
  }
}

function gate(): Promise<GateApi | null> {
  gateApi ??= loadGateApi()
  return gateApi
}

/** True when this runtime can take the gate (win32 with bun:ffi); otherwise the host cannot claim the protocol. */
export async function gitActivityGateAvailable(): Promise<boolean> {
  return (await gate()) !== null
}

export interface GitActivityGate {
  readonly release: () => void
}

type Waiter = { cancelled: boolean; readonly grant: () => void }
const mutexes = new Map<string, { held: boolean; readonly waiters: Waiter[] }>()

function lockMutex(key: string, deadline: number): Promise<boolean> {
  const mutex = mutexes.get(key) ?? { held: false, waiters: [] }
  mutexes.set(key, mutex)
  if (!mutex.held) {
    mutex.held = true
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiter.cancelled = true
      resolve(false)
    }, Math.max(0, deadline - Date.now()))
    const waiter: Waiter = {
      cancelled: false,
      grant: () => {
        clearTimeout(timer)
        resolve(true)
      },
    }
    mutex.waiters.push(waiter)
  })
}

function unlockMutex(key: string): void {
  const mutex = mutexes.get(key)
  if (mutex === undefined) return
  for (let next = mutex.waiters.shift(); next !== undefined; next = mutex.waiters.shift()) {
    if (next.cancelled) continue
    next.grant()
    return
  }
  mutex.held = false
}

/** Takes the gate, retrying until `waitMs`; null when it could not be taken in time. */
export async function acquireGitActivityGate(locksDirectory: string, waitMs = GIT_ACTIVITY_SHARED_WAIT_MS): Promise<GitActivityGate | null> {
  const api = await gate()
  if (api === null) return null
  const path = join(locksDirectory, GIT_ACTIVITY_GATE_NAME)
  const deadline = Date.now() + waitMs
  if (!(await lockMutex(path, deadline))) return null
  const wide = Buffer.from(`${path}\0`, "utf16le")
  for (;;) {
    const handle = api.open(wide)
    if (handle !== INVALID_HANDLE && handle !== 0n) {
      let released = false
      return {
        release: () => {
          if (released) return
          released = true
          api.close(handle)
          unlockMutex(path)
        },
      }
    }
    if (Date.now() >= deadline) {
      unlockMutex(path)
      return null
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
  }
}
