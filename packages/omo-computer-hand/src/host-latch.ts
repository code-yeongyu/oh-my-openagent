import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  statSync,
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

type Opened = { readonly kind: "open"; readonly fd: number } | Exclude<LatchRead, { readonly kind: "read" }>

/**
 * Opens one path component with O_NOFOLLOW and checks the DESCRIPTOR (owner is this uid, no mode
 * bits beyond `allowed`), as host/files.rs does: a link or a loose directory reads as unreadable.
 */
function openChecked(path: string, flags: number, allowed: number, what: string): Opened {
  let fd: number
  try {
    fd = openSync(path, flags | constants.O_NOFOLLOW | constants.O_RDONLY)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) throw error
    const code = String(Reflect.get(error, "code"))
    return code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable", why: `${what}:${code}` }
  }
  const stat = fstatSync(fd)
  const why =
    stat.uid !== process.getuid?.()
      ? `${what}_owner`
      : (stat.mode & 0o777 & ~allowed) !== 0
        ? `${what}_mode`
        : undefined
  if (why === undefined) return { kind: "open", fd }
  closeSync(fd)
  return { kind: "unreadable", why }
}

/** Where Linux reaches a child THROUGH a directory descriptor (openat's effect). */
const FD_ROUTE = "/proc/self/fd"

/**
 * `name` inside the open directory `fd`. On Linux it goes through the descriptor route, verified to
 * BE that directory first (same device and inode), so an ENOENT there really means absent; with the
 * route unavailable (no /proc) the answer is `undefined`, which the reader takes as unreadable.
 */
function childOf(fd: number, dir: string, name: string, fdRoute: string): string | undefined {
  if (process.platform !== "linux") return join(dir, name)
  const route = `${fdRoute}/${fd}`
  const seen = statSync(route, { throwIfNoEntry: false })
  const held = fstatSync(fd)
  return seen !== undefined && seen.dev === held.dev && seen.ino === held.ino ? `${route}/${name}` : undefined
}

/**
 * Reads `host-latch` the way the engine does (host/files.rs): the config dir and `computer/` are
 * opened O_DIRECTORY|O_NOFOLLOW and must be this uid's with no group or other bits, and the file
 * is reached THROUGH the `computer/` descriptor (Linux: /proc/self/fd, openat's effect), opened
 * O_NOFOLLOW, checked owner-only on its descriptor and read from it, under 64 KiB. Anything else is
 * unreadable, and so is a descriptor route that cannot be verified. One deliberate difference: a
 * config dir that does not exist yet reads as absent (no latch can be in it); the engine reads it as
 * set, the stricter side. `fdRoute` is the descriptor route's root (tests point it at a missing dir).
 */
export function readHostLatch(path: string, fdRoute: string = FD_ROUTE): LatchRead {
  if (process.platform === "win32") return readLatchByPath(path)
  const computer = dirname(path)
  const config = openChecked(dirname(computer), constants.O_DIRECTORY, 0o700, "config_dir")
  if (config.kind !== "open") return config
  try {
    const computerPath = childOf(config.fd, dirname(computer), "computer", fdRoute)
    if (computerPath === undefined) return { kind: "unreadable", why: "fd_route_unavailable" }
    const dir = openChecked(computerPath, constants.O_DIRECTORY, 0o700, "computer_dir")
    if (dir.kind !== "open") return dir
    try {
      const latchPath = childOf(dir.fd, computer, "host-latch", fdRoute)
      if (latchPath === undefined) return { kind: "unreadable", why: "fd_route_unavailable" }
      const file = openChecked(latchPath, 0, 0o600, "host_latch")
      if (file.kind !== "open") return file
      try {
        const stat = fstatSync(file.fd)
        if (!stat.isFile()) return { kind: "unreadable", why: "not_a_regular_file" }
        if (stat.size > MAX_BYTES) return { kind: "unreadable", why: "size" }
        return parseLatch(readFileSync(file.fd, "utf8"))
      } finally {
        closeSync(file.fd)
      }
    } finally {
      closeSync(dir.fd)
    }
  } finally {
    closeSync(config.fd)
  }
}

/** Windows (no O_NOFOLLOW, ACLs are row 60's): the file itself, never a link. */
function readLatchByPath(path: string): LatchRead {
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
  return parseLatch(readFileSync(path, "utf8"))
}

function parseLatch(text: string): LatchRead {
  let value: unknown
  try {
    value = JSON.parse(text)
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
