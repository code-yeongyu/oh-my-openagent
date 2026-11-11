// Path confinement for `/memory-merge` (#12974 security): which source tree names may become target paths,
// and how a target path is created without following a link or replacing bytes already on disk.

import { join } from "node:path"

import { lstat, mkdir, open, type FileHandle } from "../fs/resilient"
import { fsErrorCode } from "../fs/retry"

// Code points HFS+ ignores in names (git's `is_hfs_dotgit`), so `.g\u200cit` is `.git` on such a disk.
const HFS_IGNORABLE = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/gu

/**
 * Every `/`-separated name is a plain name on every disk: no backslash (a separator on Windows and to
 * `restorePaths`), and none that a disk reads as empty, `.`, `..` or git's own directory. Windows drops
 * trailing dots and spaces, reads `name:stream` as a stream of `name` and `git~1` as the short `.git`.
 */
export function isPlainTreePath(path: string): boolean {
  return path.split("/").every((name) => {
    if (name.includes("\\")) return false
    const folded = (name.replace(HFS_IGNORABLE, "").split(":", 1)[0] ?? "").replace(/[. ]+$/, "").toLowerCase()
    return folded !== "" && folded !== ".git" && folded !== "git~1"
  })
}

/**
 * Creates `destination` under `repo` as a new file. No directory on the way may be a link or a file, and
 * nothing may be on disk at the leaf: a link there (tracked or git-ignored) would carry the write outside
 * the repository, and an ignored file or the other Unicode spelling of a tracked one is the user's data.
 */
export async function createInTarget(repo: string, destination: string): Promise<FileHandle> {
  let dir = repo
  for (const name of destination.split("/").slice(0, -1)) {
    dir = join(dir, name)
    const found = await lstat(dir).catch((error: unknown) => {
      if (fsErrorCode(error) === "ENOENT") return undefined
      throw error
    })
    // `lstat` reports a link as a link, so a linked directory is refused here and never entered.
    if (found === undefined) await mkdir(dir)
    else if (!found.isDirectory())
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
