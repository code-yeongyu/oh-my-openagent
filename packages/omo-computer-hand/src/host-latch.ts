import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  writeSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"

/** The host's stop latch: `Suspended` + `stopEpoch`, held in the host and persisted beside the consent file. */
export interface HostLatch {
  readonly suspended: boolean
  readonly stopEpoch: number
}

export type LatchRead =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly latch: HostLatch }
  | { readonly kind: "unreadable"; readonly why: string }

const MAX_BYTES = 64 * 1024

/**
 * Reads `host-latch` the way the engine does (host/files.rs): owner-only file, not a symlink,
 * under 64 KiB, `{"suspended":bool,"stopEpoch":n}`. Anything else is unreadable.
 */
export function readHostLatch(path: string): LatchRead {
  let stat: Stats
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return { kind: "absent" }
    if (error instanceof Error && "code" in error)
      return { kind: "unreadable", why: String(Reflect.get(error, "code")) }
    throw error
  }
  if (!stat.isFile()) return { kind: "unreadable", why: "not_a_regular_file" }
  if ((stat.mode & 0o077) !== 0) return { kind: "unreadable", why: "mode" }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return { kind: "unreadable", why: "owner" }
  if (stat.size > MAX_BYTES) return { kind: "unreadable", why: "size" }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "unreadable", why: "parse" }
    throw error
  }
  const suspended: unknown = typeof value === "object" && value !== null ? Reflect.get(value, "suspended") : undefined
  const stopEpoch: unknown = typeof value === "object" && value !== null ? Reflect.get(value, "stopEpoch") : undefined
  if (typeof suspended !== "boolean") return { kind: "unreadable", why: "parse" }
  return {
    kind: "read",
    latch: {
      suspended,
      stopEpoch: typeof stopEpoch === "number" && Number.isSafeInteger(stopEpoch) && stopEpoch >= 0 ? stopEpoch : 0,
    },
  }
}

/** Absent is unlatched; unreadable is STOPPED; a host restart lifts nothing. */
export function effectiveLatch(read: LatchRead): HostLatch {
  switch (read.kind) {
    case "absent":
      return { suspended: false, stopEpoch: 0 }
    case "read":
      return read.latch
    case "unreadable":
      return { suspended: true, stopEpoch: 0 }
    default:
      return read satisfies never
  }
}

/** Written like the pre-input marker: exclusive temp file, fsync, rename, directory fsync; 0600 in a 0700 dir. */
export function writeHostLatch(path: string, latch: HostLatch, lineHash?: string): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temp = join(dir, `.host-latch-${randomUUID()}`)
  const fd = openSync(temp, "wx", 0o600)
  try {
    writeSync(
      fd,
      JSON.stringify({
        suspended: latch.suspended,
        stopEpoch: latch.stopEpoch,
        ...(lineHash === undefined ? {} : { lineHash }),
      }),
    )
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(temp, path)
  } finally {
    rmSync(temp, { force: true })
  }
  // A directory cannot be opened for fsync on Windows; its rename is durable through NTFS's own journal.
  if (process.platform === "win32") return
  const dirFd = openSync(dir, "r")
  try {
    fsyncSync(dirFd)
  } finally {
    closeSync(dirFd)
  }
}

/** The host's in-memory latch copy, persisted on every change before the change is visible. */
export class LatchStore {
  readonly #path: string
  #latch: HostLatch

  constructor(path: string) {
    this.#path = path
    this.#latch = effectiveLatch(readHostLatch(path))
  }

  get(): HostLatch {
    return this.#latch
  }

  set(latch: HostLatch): void {
    writeHostLatch(this.#path, latch)
    this.#latch = latch
  }
}
