// Owns the mode bits of the task store's directories under the omo agent directory.
//
// `mkdir`'s `mode` alone is not enough for this contract: the kernel masks it with the process
// umask, and Node skips it entirely when the directory already exists, so a state directory
// created by an older build at 0755 keeps 0755 forever. The explicit chmod is what makes the call
// idempotent and what repairs a legacy tree on the next write.
//
// memory-core carries the same primitive in `src/fs/private-dir.ts` (async, over its resilient fs
// boundary). Neither package depends on the other, and a workspace edge between the task engine
// and the memory engine is a larger change than this hardening warrants;
// `docs/security/filesystem.md` records the duplication.

import { chmodSync, mkdirSync, statSync } from "node:fs"

export const PRIVATE_DIR_MODE = 0o700

/** True when any group or other permission bit is set on the directory. */
export function isPublicDirMode(mode: number): boolean {
  return (mode & 0o077) !== 0
}

/**
 * Creates `directory` and every missing ancestor, then leaves `directory` itself at 0700.
 *
 * Directories are the unit of this contract; files inside are the writer's business. Ancestors
 * above `directory` are tightened only when this call is the one that creates them.
 *
 * @returns whether the call tightened a directory that already existed. False on a first create
 * and on an already-private directory, which is what makes a second call a no-op.
 */
export function ensurePrivateDirectory(directory: string): boolean {
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIR_MODE })
  const current = statSync(directory)
  if (!current.isDirectory() || !isPublicDirMode(current.mode)) return false
  chmodSync(directory, PRIVATE_DIR_MODE)
  return true
}