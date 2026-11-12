// Path confinement for `/memory-merge` (#12974 security): which source tree names may become target paths,
// and how a target path is created without following a link or replacing bytes already on disk.

import { join, relative, sep } from "node:path"

import { lstat, mkdir, open, rmdir, type FileHandle } from "../fs/resilient"
import { fsErrorCode } from "../fs/retry"

// Code points HFS+ ignores in names (git's `is_hfs_dotgit`), so `.g\u200cit` is `.git` on such a disk.
const HFS_IGNORABLE = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/gu

/**
 * Every `/`-separated name is a plain name on every disk: no backslash (a separator on Windows and to
 * `restorePaths`), and none that a disk reads as empty, `.`, `..` or git's own directory. Windows drops
 * trailing dots and spaces, reads `name:stream` as a stream of `name` and `git~1` as the short `.git`.
 */
/** How a disk reads one name: HFS+ ignorables dropped, `name:stream` cut to `name`, trailing dots and spaces dropped, lowercased. */
export function foldTreeName(name: string): string {
  return (name.replace(HFS_IGNORABLE, "").split(":", 1)[0] ?? "").replace(/[. ]+$/, "").toLowerCase()
}

export function isPlainTreePath(path: string): boolean {
  return path.split("/").every((name) => {
    if (name.includes("\\")) return false
    const folded = foldTreeName(name)
    return folded !== "" && folded !== ".git" && folded !== "git~1"
  })
}

/**
 * Creates `destination` under `repo` as a new file. No directory on the way may be a link or a file, and
 * nothing may be on disk at the leaf: a link there (tracked or git-ignored) would carry the write outside
 * the repository, and an ignored file or the other Unicode spelling of a tracked one is the user's data.
 */
export async function createInTarget(repo: string, destination: string, created: string[] = []): Promise<FileHandle> {
  let dir = repo
  for (const name of destination.split("/").slice(0, -1)) {
    dir = join(dir, name)
    const found = await lstat(dir).catch((error: unknown) => {
      if (fsErrorCode(error) === "ENOENT") return undefined
      throw error
    })
    // `lstat` reports a link as a link, so a linked directory is refused here and never entered.
    if (found === undefined) {
      await mkdir(dir)
      created.push(dir)
    } else if (!found.isDirectory())
      throw new Error(
        `memory merge: ${destination} would be written through a link or file in the target; nothing was merged`,
      )
  }
  try {
    // `wx` is O_CREAT|O_EXCL: it fails on anything at the leaf, a dangling link included, and never follows one.
    return await open(join(repo, destination), "wx")
  } catch (error) {
    if (fsErrorCode(error) !== "EEXIST") throw error
    throw new Error(`memory merge: ${destination} is already on the target disk outside git; nothing was merged`)
  }
}

/**
 * A tree entry is written under the target repository only as a plain relative path: git stores a backslash
 * as an ordinary character, so a name like notes\\..\\..\\x.md would climb out once a platform treats it as a
 * separator. Absolute paths and empty, '.' or '..' segments (after normalising backslashes) are refused.
 */
export function isMergePathConfined(path: string): boolean {
  const normalized = path.replaceAll("\\", "/")
  const windowsAbsolute = /^[a-zA-Z]:\//.test(normalized)
  const segments = normalized.split("/")
  return !(
    normalized.startsWith("/") ||
    windowsAbsolute ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  )
}

/** The last check before a planned destination is created: a path that is not confined aborts the whole merge. */
export function assertMergePathConfined(path: string): void {
  if (!isMergePathConfined(path))
    throw new Error(`memory merge: ${path} is outside the memory repository; nothing was merged`)
}

/** Why a source entry was left out of a merge: its name is not a plain path on every disk. */
export type UnplaceableReason = "not-a-plain-path"

export interface LeftoverDir {
  /** Relative to the repository, `/`-separated. */
  readonly path: string
  readonly code: string
}

/**
 * Removes, deepest first, the directories createInTarget made, only while they are empty, so a refused merge
 * leaves no trace. Best effort: a directory it cannot remove (a link put in its place, a busy directory on
 * Windows) is returned instead of thrown, so cleanup never replaces the outcome of the merge it cleans up.
 */
export async function removeCreatedDirs(repo: string, created: readonly string[]): Promise<readonly LeftoverDir[]> {
  const leftover: LeftoverDir[] = []
  for (const dir of [...created].reverse()) {
    await rmdir(dir).catch((error: unknown) => {
      const code = fsErrorCode(error)
      if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST") return
      leftover.push({ path: relative(repo, dir).split(sep).join("/"), code: code ?? String(error) })
    })
  }
  return leftover
}

/** Records on the error a rollback is rethrowing the directories it could not remove, keeping any cause it had. */
export function attachLeftoverDirs(error: unknown, leftover: readonly LeftoverDir[]): void {
  if (leftover.length === 0 || !(error instanceof Error)) return
  const listed = leftover.map((dir) => `${dir.path} (${dir.code})`).join(", ")
  const failure = new Error(`memory merge: could not remove directories it created: ${listed}`)
  error.cause = error.cause === undefined ? failure : new AggregateError([error.cause, failure], failure.message)
}
