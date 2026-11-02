import { constants as osConstants } from "node:os"

// flock(2) through bun:ffi, so liveness can be answered by the kernel instead of by reading other
// processes' /proc entries (omo #10322). A flock belongs to the open file description: every
// process that inherits the descriptor keeps it held, and the kernel drops it when the last such
// process exits, SIGKILL included. Only non-blocking attempts are made, so the JS thread never
// waits inside the kernel.

const LOCK_SH = 1
const LOCK_EX = 2
const LOCK_NB = 4

const LIBC: Partial<Record<NodeJS.Platform, { readonly names: readonly string[]; readonly errnoSymbol: string }>> = {
  darwin: { names: ["/usr/lib/libSystem.B.dylib"], errnoSymbol: "__error" },
  linux: { names: ["libc.so.6", "libc.musl-x86_64.so.1", "libc.musl-aarch64.so.1", "libc.so"], errnoSymbol: "__errno_location" },
}

// Returns flock's result and, when it failed, the errno read right after the call on the same thread.
type Flock = (fd: number, operation: number) => { readonly rc: number; readonly errno: number }

let flockLookup: Promise<Flock | null> | null = null

async function openFlock(): Promise<Flock | null> {
  const libc = LIBC[process.platform]
  if (libc === undefined) return null
  let ffi: typeof import("bun:ffi")
  try {
    ffi = await import("bun:ffi")
  } catch {
    return null
  }
  for (const name of libc.names) {
    try {
      const library = ffi.dlopen(name, {
        flock: { args: [ffi.FFIType.i32, ffi.FFIType.i32], returns: ffi.FFIType.i32 },
        [libc.errnoSymbol]: { args: [], returns: ffi.FFIType.ptr },
      })
      const errnoAt = library.symbols[libc.errnoSymbol]
      if (errnoAt === undefined) continue
      return (fd, operation) => {
        const rc = Number(library.symbols.flock(fd, operation))
        if (rc === 0) return { rc, errno: 0 }
        const pointer = errnoAt()
        return { rc, errno: pointer === null ? -1 : ffi.read.i32(pointer, 0) }
      }
    } catch {
      continue
    }
  }
  return null
}

function loadFlock(): Promise<Flock | null> {
  flockLookup ??= openFlock()
  return flockLookup
}

export async function osFileLockAvailable(): Promise<boolean> {
  return (await loadFlock()) !== null
}

export type OsLockAttempt =
  | { readonly kind: "acquired" }
  | { readonly kind: "busy" }
  // This host or filesystem cannot take the lock at all; callers fall back to the behavior without it.
  | { readonly kind: "unavailable"; readonly errno?: number }
  // Anything else is a real failure (a bad descriptor, an unreadable errno): never read as idle or busy.
  | { readonly kind: "failed"; readonly errno: number }

const errnos = osConstants.errno

// omo #10604 review M1: only "another process holds a conflicting lock" is busy. The calls are
// non-blocking, so EINTR means nothing was decided and the caller tries again.
export function classifyFlockFailure(errno: number): OsLockAttempt {
  if (errno === errnos.EWOULDBLOCK || errno === errnos.EAGAIN || errno === errnos.EINTR) return { kind: "busy" }
  if (errno === errnos.ENOLCK || errno === errnos.EOPNOTSUPP || errno === errnos.ENOTSUP || errno === errnos.ENOSYS) {
    return { kind: "unavailable", errno }
  }
  return { kind: "failed", errno }
}

async function attempt(fd: number, mode: number): Promise<OsLockAttempt> {
  const flock = await loadFlock()
  if (flock === null) return { kind: "unavailable" }
  const { rc, errno } = flock(fd, mode | LOCK_NB)
  return rc === 0 ? { kind: "acquired" } : classifyFlockFailure(errno)
}

export function tryLockShared(fd: number): Promise<OsLockAttempt> {
  return attempt(fd, LOCK_SH)
}

export function tryLockExclusive(fd: number): Promise<OsLockAttempt> {
  return attempt(fd, LOCK_EX)
}
