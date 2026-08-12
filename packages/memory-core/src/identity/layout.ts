// Storage layout constants and path builders for memory identities.
// Layout decision (plan todo 3): <memory-root>/agents/<safe-id>/{repo,runtime/...}
// where memory-root = OMO_MEMORY_HOME override else ~/.omo/memory.

import { homedir } from "node:os"
import { join, resolve } from "node:path"

export const MEMORY_ROOT_ENV_VAR = "OMO_MEMORY_HOME"
export const AGENTS_DIRNAME = "agents"
export const REPO_DIRNAME = "repo"
export const RUNTIME_DIRNAME = "runtime"
export const RUNTIME_SUBDIRNAMES = [
  "locks",
  "transcripts",
  "reflection",
  "reflection-sessions",
  "worktrees",
  "viewers",
  "push-queue",
  "facts-queue",
  "facts",
  "notices",
  "tool-receipts",
] as const
export type RuntimeSubdirname = (typeof RUNTIME_SUBDIRNAMES)[number]

export interface MemoryIdentityPaths {
  root: string
  repo: string
  runtime: string
  locks: string
  transcripts: string
  reflection: string
  reflectionSessions: string
  worktrees: string
  viewers: string
  pushQueue: string
  factsQueue: string
  facts: string
  notices: string
  toolReceipts: string
}

export function defaultMemoryRoot(): string {
  return join(homedir(), ".omo", "memory")
}

export function resolveMemoryRoot(env: Record<string, string | undefined>, cwd: string): string {
  const override = env[MEMORY_ROOT_ENV_VAR]
  if (override === undefined || override.trim() === "") {
    return defaultMemoryRoot()
  }
  return resolve(cwd, override)
}

export function buildIdentityPaths(memoryRoot: string, id: string): MemoryIdentityPaths {
  const root = join(memoryRoot, AGENTS_DIRNAME, id)
  const runtime = join(root, RUNTIME_DIRNAME)
  return {
    root,
    repo: join(root, REPO_DIRNAME),
    runtime,
    locks: join(runtime, "locks"),
    transcripts: join(runtime, "transcripts"),
    reflection: join(runtime, "reflection"),
    reflectionSessions: join(runtime, "reflection-sessions"),
    worktrees: join(runtime, "worktrees"),
    viewers: join(runtime, "viewers"),
    pushQueue: join(runtime, "push-queue"),
    factsQueue: join(runtime, "facts-queue"),
    facts: join(runtime, "facts"),
    notices: join(runtime, "notices"),
    toolReceipts: join(runtime, "tool-receipts"),
  }
}
