// Owns the mode bits of every directory memory-core materialises under `~/.omo/memory`.
//
// `mkdir`'s `mode` alone is not enough for this contract: the kernel masks it with the process
// umask, and Node skips it entirely when the directory already exists, so a directory created by
// an older build at 0755 keeps 0755 forever. The explicit chmod is what makes the call idempotent
// and what repairs a legacy tree on the next write.
//
// senpi-task carries the same primitive in `src/store/private-dir.ts`. Neither package depends on
// the other, and adding a workspace edge between the memory engine and the task engine is a larger
// change than this hardening warrants; `docs/security/filesystem.md` records the duplication.

import { chmod, mkdir, stat } from "./resilient"

export const PRIVATE_DIR_MODE = 0o700

/** True when the owner read/write/execute bits are the only ones set. */
export function isPublicDirMode(mode: number): boolean {
  return (mode & 0o077) !== 0
}

function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false
  return (error as { code?: unknown }).code === "ENOENT"
}

/**
 * Creates `directory` and every missing ancestor, then leaves `directory` itself at 0700.
 *
 * Directories are the unit of this contract; files inside are the writer's business. Ancestors
 * above `directory` are tightened only when this call is the one that creates them.
 *
 * @returns whether the call actually tightened an existing directory. False on a first create
 * (nothing pre-existed to tighten) and on an already-private directory, which is what makes a
 * second call a no-op.
 */
export async function ensurePrivateDirectory(directory: string): Promise<boolean> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIR_MODE })
  let current
  try {
    current = await stat(directory)
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
  if (!current.isDirectory() || !isPublicDirMode(current.mode)) return false
  await chmod(directory, PRIVATE_DIR_MODE)
  return true
}