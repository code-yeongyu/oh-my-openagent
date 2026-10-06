import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { COMMENT_CHECKER_RELEASE_VERSION } from "./release"

/**
 * The shared binary cache has one unversioned slot, so a checker an older install left there would be
 * reused forever and the pinned release never fetched (#8850). The downloader records the release it
 * extracted in this file beside the binary; a missing or different marker means the slot is stale.
 */
export const COMMENT_CHECKER_VERSION_MARKER = "comment-checker.version"

export function isCachedCommentCheckerCurrent(
  cacheDir: string,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf-8"),
): boolean {
  try {
    return readFile(join(cacheDir, COMMENT_CHECKER_VERSION_MARKER)).trim() === COMMENT_CHECKER_RELEASE_VERSION
  } catch {
    return false
  }
}

export function recordCachedCommentCheckerRelease(cacheDir: string): void {
  writeFileSync(join(cacheDir, COMMENT_CHECKER_VERSION_MARKER), `${COMMENT_CHECKER_RELEASE_VERSION}\n`)
}
