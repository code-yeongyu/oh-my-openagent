import { randomBytes } from "node:crypto"
import { constants, type Stats } from "node:fs"
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { accountHome } from "./account-home"
import { withCredentialLock } from "./credential-lock"
import type { SealedStore } from "./keystore"

/**
 * The shared OmO sign-in at rest on a Linux machine with no Secret Service (#7185b, "the Tailscale way", like
 * tailscaled.state): a plain file only this user can read, in a directory only this user can enter. The file is the
 * credential, so every read proves it is still private before using it, and a write never leaves a partial or briefly
 * readable file behind. The desktop keeps its own sign-in under the same rules.
 */
export const ACCOUNT_STATE_DIR = "account-state"

const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK, O_DIRECTORY } = constants
const GROUP_OR_WORLD = 0o077

export type StateFileRefusal =
  "dir-not-a-directory" | "dir-other-owner" | "dir-open" | "symlink" | "not-a-file" | "other-owner" | "open"

/** The file or its directory is not private to this user: it is never used and never written to. */
export class StateFileRefused extends Error {
  constructor(readonly refusal: StateFileRefusal) {
    super(`the private sign-in file was refused (${refusal})`)
  }
}

export const stateFileDirectory = (home: string): string => join(home, ".omo", ACCOUNT_STATE_DIR)

const errnoCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined

/** The directory's own entry (never followed): a real directory of this user nobody else can enter. */
export const dirRefusal = (stat: Stats, uid: number): StateFileRefusal | undefined =>
  !stat.isDirectory()
    ? "dir-not-a-directory"
    : stat.uid !== uid
      ? "dir-other-owner"
      : (stat.mode & GROUP_OR_WORLD) !== 0
        ? "dir-open"
        : undefined

/** The opened file itself: a regular file of this user nobody else can read or write. */
export const fileRefusal = (stat: Stats, uid: number): StateFileRefusal | undefined =>
  !stat.isFile()
    ? "not-a-file"
    : stat.uid !== uid
      ? "other-owner"
      : (stat.mode & GROUP_OR_WORLD) !== 0
        ? "open"
        : undefined

async function checkDir(dir: string, uid: number): Promise<boolean> {
  const stat = await lstat(dir).catch((error: unknown) => {
    if (errnoCode(error) === "ENOENT") return null
    throw error
  })
  if (stat === null) return false
  const refusal = dirRefusal(stat, uid)
  if (refusal !== undefined) throw new StateFileRefused(refusal)
  return true
}

/**
 * The file's text, null when there is none. It is opened without following a symlink and judged on the open
 * descriptor, so it cannot be swapped between the check and the read; O_NONBLOCK keeps a FIFO from hanging the open.
 */
export async function readStateFile(dir: string, name: string, uid: number): Promise<string | null> {
  if (!(await checkDir(dir, uid))) return null
  const handle = await open(join(dir, name), O_RDONLY | O_NOFOLLOW | O_NONBLOCK).catch((error: unknown) => {
    const code = errnoCode(error)
    if (code === "ENOENT") return null
    if (code === "ELOOP") throw new StateFileRefused("symlink")
    throw error
  })
  if (handle === null) return null
  try {
    const refusal = fileRefusal(await handle.stat(), uid)
    if (refusal !== undefined) throw new StateFileRefused(refusal)
    return await handle.readFile("utf8")
  } finally {
    await handle.close()
  }
}

// Under the credential lock no other write is running, so a temp file of this name is one a crash left before its
// rename: it holds a credential and is removed, without following a symlink.
async function removeTempLeftovers(dir: string, name: string): Promise<void> {
  const entries = await readdir(dir).catch((error: unknown) => {
    if (errnoCode(error) === "ENOENT") return []
    throw error
  })
  for (const entry of entries)
    if (entry.startsWith(`.${name}.`) && entry.endsWith(".tmp")) await rm(join(dir, entry), { force: true })
}

/**
 * Replaces the file atomically: a temp file created 0600 (never wider, whatever the umask) in the same private dir,
 * written and synced, then renamed over the old one, then the dir synced. A refused dir is never written to.
 */
export async function writeStateFile(dir: string, name: string, contents: string, uid: number): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await checkDir(dir, uid)
  await removeTempLeftovers(dir, name)
  const temp = join(dir, `.${name}.${randomBytes(8).toString("hex")}.tmp`)
  try {
    const handle = await open(temp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    try {
      await handle.writeFile(contents, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, join(dir, name))
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  // The rename is durable only once the directory entry is; a filesystem that cannot sync a directory still renamed.
  const directory = await open(dir, O_RDONLY | O_DIRECTORY)
  try {
    await directory.sync().catch(() => undefined)
  } finally {
    await directory.close()
  }
}

/** A symlink in the file's place is unlinked itself, never followed to its target. */
export async function removeStateFile(dir: string, name: string): Promise<void> {
  await removeTempLeftovers(dir, name)
  await rm(join(dir, name), { force: true })
}

export type StateFileStore<T> = SealedStore<T> & {
  /** The stored text as written, or null when there is none or it was refused (one line, never its content). */
  readonly text: () => Promise<string | null>
  /** True while any entry sits at the file's path, refused or not. */
  readonly present: () => Promise<boolean>
  readonly directory: () => string
}

export function createStateFileStore<T>(input: {
  readonly api: string
  readonly name: string
  /** The credential lock's home; the file sits beside the lock, so every process of this user meets on both. */
  readonly home?: string
  readonly codec: {
    readonly parse: (text: string) => T
    readonly serialize: (value: T) => string
    readonly amend?: (previous: string | null, next: T) => T
  }
  readonly failure: (message: string) => Error
  readonly log?: (line: string) => void
}): StateFileStore<T> {
  const { api, name, codec, failure } = input
  const log = input.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  const uid = process.getuid?.() ?? -1
  const directory = () => stateFileDirectory(input.home ?? accountHome())
  const failed = (operation: string, error: unknown): Error =>
    error instanceof StateFileRefused
      ? failure(`omo: cannot ${operation} the private sign-in file in ${directory()}: ${error.message}.`)
      : failure(
          `omo: cannot ${operation} the private sign-in file in ${directory()} (${errnoCode(error) ?? "unknown"}).`,
        )
  const text = async (): Promise<string | null> => {
    try {
      return await readStateFile(directory(), name, uid)
    } catch (error) {
      if (!(error instanceof StateFileRefused)) throw failed("read", error)
      log(`omo: ${error.message} in ${directory()} and is not used; this computer reads as signed out.`)
      return null
    }
  }
  const read = async (): Promise<T | null> => {
    const stored = await text()
    return stored === null ? null : codec.parse(stored)
  }
  const locked = (action: () => Promise<void>): Promise<void> =>
    withCredentialLock(api, action, input.home ?? accountHome())
  return {
    read,
    readAuthoritative: read,
    text,
    directory,
    present: async () => (await lstat(join(directory(), name)).catch(() => null)) !== null,
    write: (value) =>
      locked(async () => {
        const next = codec.amend === undefined ? value : codec.amend(await text(), value)
        try {
          await writeStateFile(directory(), name, codec.serialize(next), uid)
        } catch (error) {
          throw failed("write", error)
        }
      }),
    clear: () =>
      locked(async () => {
        try {
          await removeStateFile(directory(), name)
        } catch (error) {
          throw failed("remove", error)
        }
      }),
  }
}
