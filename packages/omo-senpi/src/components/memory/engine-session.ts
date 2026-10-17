import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  GitMemoryRepo,
  LockContentionError,
  MemoryToolError,
  buildDefaultSeedFiles,
  createLockRecord,
  frontmatterNormalizationPending,
  installHooks,
  memoryWriterLockPath,
  normalizeMemoryFrontmatter,
  withLock,
  type GitCommitAuthor,
  type MemoryIdentityPaths,
  type MemoryToolLock,
  type NormalizeFrontmatterResult,
} from "@oh-my-opencode/memory-core"

import { ensureIdentityRuntimeDirs } from "./context"

// Shared engine-prep for the two memory tool surfaces (direct senpi ToolDefinitions and the standalone
// MCP server). Pure memory-core + fs so the MCP bundle can inline it without the senpi runtime.

export interface MemoryEngineSession {
  readonly repo: GitMemoryRepo
  readonly lock: MemoryToolLock
  readonly author: GitCommitAuthor
  /** Legacy-frontmatter repair outcome; only the first preparation per repository in this process runs it. */
  readonly normalization?: NormalizeFrontmatterResult
}

const normalizedRepos = new Set<string>()

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
  const author: GitCommitAuthor = { agentId: identity, authorName: identity }
  if (!existsSync(join(identityPaths.repo, ".git"))) {
    await lock("memory-write", async () => {
      if (!existsSync(join(identityPaths.repo, ".git"))) {
        await repo.init({ seedFiles: buildDefaultSeedFiles(), installHooks: (dir) => { installHooks(dir) } })
      }
    })
  }
  if (normalizedRepos.has(identityPaths.repo)) return { repo, lock, author }
  if (!(await frontmatterNormalizationPending(repo))) {
    normalizedRepos.add(identityPaths.repo)
    return { repo, lock, author }
  }
  try {
    const normalization = await lock("memory-write", async () => {
      installHooks(identityPaths.repo)
      return normalizeMemoryFrontmatter(repo, author)
    })
    normalizedRepos.add(identityPaths.repo)
    return { repo, lock, author, normalization }
  } catch (error) {
    // Another writer owns the repository right now. The tool's own lock acquisition reports the
    // contention to the caller, and the next preparation in this process retries the repair.
    if (error instanceof LockContentionError) return { repo, lock, author }
    throw error
  }
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
