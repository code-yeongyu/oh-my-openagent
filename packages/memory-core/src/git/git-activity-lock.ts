import { basename, dirname, join, resolve } from "node:path"

import { AGENTS_DIRNAME, REPO_DIRNAME, RUNTIME_DIRNAME } from "../identity"

import { constants, mkdir, open, type FileHandle } from "../fs/resilient"
import { tryLockExclusive, tryLockShared } from "../locks/os-file-lock"
import { GitError } from "./errors"
import { isOnLocalFilesystem } from "./local-filesystem"

// omo #10322: which memory-core git processes are alive in a memory repository is answered by the
// kernel, not by /proc (whose same-uid entries are unreadable on systemd desktops, sshd sessions
// and hosted runners). Every memory-core git run holds a SHARED flock on the identity's
// git-activity lock and hands the descriptor to git as fd 3, so git, its hooks and anything they
// leave behind - the orphans of a SIGKILLed writer included - keep it held until the last of them
// exits. The stranded-lock sweep takes it EXCLUSIVELY: acquired means no such process is alive,
// and holding it across the unlink keeps a new git run from starting in between.
// Scope: it covers memory-core's own git only. A git started outside memory-core (a user's or an
// IDE's, or an older omo build's) never holds it, so idle never proves such a process gone.

// Not `*.lock`: every scanner of the locks directory (doctor, the dead-owner sweep) reads a `*.lock` as
// a JSON lock record, and this file is an empty flock target that must never be reported or removed.
export const GIT_ACTIVITY_LOCK_NAME = "git-activity.flock"

// A sweep holds the exclusive lock only across a stat and an unlink, so a shared attempt that
// keeps failing this long means the lock cannot be taken at all; git then must not run unseen.
export const GIT_ACTIVITY_SHARED_WAIT_MS = 10_000
const SHARED_RETRY_MS = 5

// The identity layout (identity/layout.ts) pins the runtime locks next to the repo:
// <root>/agents/<id>/repo and <root>/agents/<id>/runtime/locks.
export function identityLocksDirForRepo(repoDir: string): string | null {
  const resolved = resolve(repoDir)
  if (basename(resolved) !== REPO_DIRNAME || basename(dirname(dirname(resolved))) !== AGENTS_DIRNAME) return null
  return join(dirname(resolved), RUNTIME_DIRNAME, "locks")
}

export class GitActivityLockError extends GitError {}

export interface GitActivityHold {
  readonly fd: number
  readonly release: () => Promise<void>
}

// `vouches`: idle may stand in for an unanswerable /proc scan, because the lock file lives on a
// local filesystem whose flock git inherits (local-filesystem.ts). Busy is safe to act on anywhere.
export type GitActivityProbe =
  | { readonly kind: "idle"; readonly vouches: boolean; readonly release: () => Promise<void> }
  | { readonly kind: "busy" }
  | { readonly kind: "unavailable" }

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

async function mkdirIfMissing(dir: string): Promise<void> {
  try {
    await mkdir(dir)
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error
  }
}

// Never recursive: a git run that outlives its memory home (a removed identity, a test root torn down)
// must not recreate it, so a missing identity directory means there is no activity lock to hold.
async function openActivityLock(repoDir: string): Promise<FileHandle | null> {
  const locksDir = identityLocksDirForRepo(repoDir)
  if (locksDir === null) return null
  try {
    await mkdirIfMissing(dirname(locksDir))
    await mkdirIfMissing(locksDir)
    return await open(join(locksDir, GIT_ACTIVITY_LOCK_NAME), constants.O_RDWR | constants.O_CREAT, 0o600)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null
    throw error
  }
}

// git cannot create a lock file on a read-only memory home, so nothing can strand there; a home this
// user may not write (EACCES/EPERM) cannot strand one either (omo #10604 review LOW 3).
function cannotWriteMemoryHome(error: unknown): boolean {
  const code = errorCode(error)
  return code === "EROFS" || code === "EACCES" || code === "EPERM"
}

/** Held around one git run in `repoDir`; null when the repo is outside the identity layout or the host has no kernel lock. */
export async function holdGitActivityShared(repoDir: string): Promise<GitActivityHold | null> {
  let handle: FileHandle | null
  try {
    handle = await openActivityLock(repoDir)
  } catch (error) {
    if (cannotWriteMemoryHome(error)) return null
    throw error
  }
  if (handle === null) return null
  const deadline = Date.now() + GIT_ACTIVITY_SHARED_WAIT_MS
  for (;;) {
    const outcome = await tryLockShared(handle.fd)
    if (outcome.kind === "acquired") {
      const held = handle
      return { fd: held.fd, release: () => held.close() }
    }
    // The filesystem cannot take the lock at all: git runs as it did before the lock existed, and the
    // sweep's exclusive attempt on the same file cannot take it either, so it never vouches.
    if (outcome.kind === "unavailable") {
      await handle.close()
      return null
    }
    if (outcome.kind === "failed") {
      await handle.close()
      throw new GitActivityLockError(`The memory repository's git-activity lock failed with errno ${outcome.errno}: ${repoDir}`)
    }
    if (Date.now() >= deadline) {
      await handle.close()
      throw new GitActivityLockError(`The memory repository's git-activity lock stayed exclusively held for ${GIT_ACTIVITY_SHARED_WAIT_MS} ms: ${repoDir}`)
    }
    await new Promise((resolveRetry) => setTimeout(resolveRetry, SHARED_RETRY_MS))
  }
}

/** Idle (and held exclusively until released) only when no memory-core git process is alive in `repoDir`. */
export async function probeGitActivityIdle(repoDir: string): Promise<GitActivityProbe> {
  const handle = await openActivityLock(repoDir).catch(() => null)
  if (handle === null) return { kind: "unavailable" }
  const outcome = await tryLockExclusive(handle.fd)
  if (outcome.kind === "acquired") {
    const locksDir = identityLocksDirForRepo(repoDir)
    const vouches = locksDir !== null && (await isOnLocalFilesystem(locksDir))
    return { kind: "idle", vouches, release: () => handle.close() }
  }
  await handle.close()
  // A failed attempt is never read as idle: the sweep keeps every lock it would have vouched for.
  return outcome.kind === "busy" ? { kind: "busy" } : { kind: "unavailable" }
}
