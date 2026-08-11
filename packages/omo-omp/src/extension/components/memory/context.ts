import { mkdir } from "node:fs/promises"

import type { MemoryIdentityPaths } from "@oh-my-opencode/memory-core"

import type { MemorySessionBinding } from "./binding"

export interface MemoryPendingLedger {
  pendingCompaction: boolean
  configRestartNotified: boolean
}

export interface MemoryRepoAccess {
  readonly path: string
  ensureRuntimeDirs(): Promise<void>
}

export interface MemoryIdentityContext {
  readonly identity: string
  readonly identityPaths: MemoryIdentityPaths
  readonly repoAccess: MemoryRepoAccess
  readonly binding: MemorySessionBinding
  readonly ledger: MemoryPendingLedger
}

export function createMemoryIdentityContext(input: {
  readonly identity: string
  readonly identityPaths: MemoryIdentityPaths
  readonly binding: MemorySessionBinding
}): MemoryIdentityContext {
  let repoAccess: MemoryRepoAccess | undefined
  return {
    identity: input.identity,
    identityPaths: input.identityPaths,
    binding: input.binding,
    ledger: { pendingCompaction: false, configRestartNotified: false },
    get repoAccess(): MemoryRepoAccess {
      repoAccess ??= {
        path: input.identityPaths.repo,
        ensureRuntimeDirs: () => ensureIdentityRuntimeDirs(input.identityPaths),
      }
      return repoAccess
    },
  }
}

export function getMemoryRepo(context: MemoryIdentityContext): MemoryRepoAccess {
  return context.repoAccess
}

/** First-write seam: callers invoke this before mutation; reads must never create identity storage. */
export async function ensureIdentityRuntimeDirs(paths: MemoryIdentityPaths): Promise<void> {
  await Promise.all([
    paths.locks,
    paths.transcripts,
    paths.reflection,
    paths.reflectionSessions,
    paths.worktrees,
    paths.viewers,
    paths.pushQueue,
  ].map((path) => mkdir(path, { recursive: true })))
}
