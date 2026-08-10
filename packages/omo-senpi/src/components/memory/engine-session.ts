import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  GitMemoryRepo,
  MemoryToolError,
  buildDefaultSeedFiles,
  createLockRecord,
  installHooks,
  memoryWriterLockPath,
  withLock,
  type GitCommitAuthor,
  type MemoryIdentityPaths,
  type MemoryToolLock,
} from "@oh-my-opencode/memory-core"

import { ensureIdentityRuntimeDirs } from "./context"

// Shared engine-prep for the two memory tool surfaces (direct senpi ToolDefinitions and the standalone
// MCP server). Pure memory-core + fs so the MCP bundle can inline it without the senpi runtime.

export interface MemoryEngineSession {
  readonly repo: GitMemoryRepo
  readonly lock: MemoryToolLock
  readonly author: GitCommitAuthor
}

export interface MemoryEngineSessionOptions {
  readonly lockWaitTimeoutMs?: number
  readonly lockRetryDelayMs?: number
}

export async function prepareMemoryEngineSession(
  identity: string,
  identityPaths: MemoryIdentityPaths,
  options: MemoryEngineSessionOptions = {},
): Promise<MemoryEngineSession> {
  // First-write seam: runtime dirs (including the locks directory) must exist before the writer
  // lock publishes into them; reads never create identity storage.
  await ensureIdentityRuntimeDirs(identityPaths)
  const repo = new GitMemoryRepo({ dir: identityPaths.repo, agentId: identity })
  const lock = createMemoryWriterLock(identity, identityPaths, options)
  if (!existsSync(join(identityPaths.repo, ".git"))) {
    await lock("memory-write", async () => {
      if (!existsSync(join(identityPaths.repo, ".git"))) {
        await repo.init({ seedFiles: buildDefaultSeedFiles(), installHooks: (dir) => { installHooks(dir) } })
      }
    })
  }
  return { repo, lock, author: { agentId: identity, authorName: identity } }
}

function createMemoryWriterLock(
  identity: string,
  identityPaths: MemoryIdentityPaths,
  options: MemoryEngineSessionOptions,
): MemoryToolLock {
  return async (domain, operation) => {
    if (domain !== "memory-write") throw new MemoryToolError(`unsupported lock domain '${domain}'`)
    const record = await createLockRecord(`memory tool (${identity})`)
    return withLock(memoryWriterLockPath(identityPaths.locks), record, operation, {
      waitTimeoutMs: options.lockWaitTimeoutMs ?? 5_000,
      ...(options.lockRetryDelayMs === undefined ? {} : { retryDelayMs: options.lockRetryDelayMs }),
    })
  }
}
