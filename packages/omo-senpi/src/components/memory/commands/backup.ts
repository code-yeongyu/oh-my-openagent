// Repository backup/restore primitives for /memfs.
//
// Backups are plain directory copies placed beside the repo as
// <identity-root>/memory-backup-<YYYYMMDD-HHMMSS> (letta parity: sibling dirs).

import { existsSync } from "node:fs"
import { cp, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import type { MemoryCommandDeps, MemoryCommandIdentity } from "./types"

export const BACKUP_PREFIX = "memory-backup-"

export function backupTimestamp(epochMs: number): string {
  const iso = new Date(epochMs).toISOString()
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`
}

function backupRoot(identity: MemoryCommandIdentity): string {
  return identity.identityPaths.root
}

/** Copies the repository to a fresh sibling directory; never clobbers an existing backup. */
export async function createRepoBackup(
  deps: MemoryCommandDeps,
  identity: MemoryCommandIdentity,
): Promise<string> {
  const stamp = backupTimestamp((deps.now ?? Date.now)())
  const root = backupRoot(identity)
  let candidate = join(root, `${BACKUP_PREFIX}${stamp}`)
  let suffix = 2
  while (existsSync(candidate)) {
    candidate = join(root, `${BACKUP_PREFIX}${stamp}-${suffix}`)
    suffix += 1
  }
  await cp(identity.identityPaths.repo, candidate, { recursive: true })
  return candidate
}

export async function listRepoBackups(identity: MemoryCommandIdentity): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(backupRoot(identity))
  } catch {
    return []
  }
  return entries.filter((entry) => entry.startsWith(BACKUP_PREFIX)).sort()
}

export interface RestoreResult {
  readonly restored: string
  readonly safetyBackup: string | undefined
}

export async function restoreRepoBackup(
  deps: MemoryCommandDeps,
  identity: MemoryCommandIdentity,
  name: string,
): Promise<RestoreResult> {
  const source = join(backupRoot(identity), name)
  const repoDir = identity.identityPaths.repo
  const safetyBackup = existsSync(repoDir) ? await createRepoBackup(deps, identity) : undefined
  await rm(repoDir, { recursive: true, force: true })
  await cp(source, repoDir, { recursive: true })
  return { restored: name, safetyBackup }
}
