// /memory cleanup [--apply]: the memory-core cleanup planner over the bound identity's repository. Dry run is the
// default and prints the report; --apply re-plans, refuses a moved repository, and commits one cleanup write.

import {
  MEMORY_CLEANUP_CLASSES,
  applyMemoryCleanup,
  createLockRecord,
  memoryWriterLockPath,
  planMemoryCleanup,
  renderMemoryCleanupReport,
  withLock,
  type MemoryCleanupClass,
  type MemoryWriteLock,
} from "@oh-my-opencode/memory-core"

import type { ParsedCommandArgs } from "./args"
import { hasGitRepo, openRepo } from "./repo"
import {
  respond,
  sessionIdOf,
  type MemoryCommandContext,
  type MemoryCommandDeps,
  type MemoryCommandIdentity,
} from "./types"

export const MEMORY_CLEANUP_BOOLEAN_FLAGS = ["apply", "include-load-bearing", "json"] as const

export const MEMORY_CLEANUP_USAGE = `usage: /memory cleanup [--apply] [--include-load-bearing] [--only ${MEMORY_CLEANUP_CLASSES.join(",")}] [--skip <path>[,<path>]] [--json]`

export async function runMemoryCleanup(
  deps: MemoryCommandDeps,
  ctx: MemoryCommandContext,
  identity: MemoryCommandIdentity,
  parsed: ParsedCommandArgs,
): Promise<string> {
  if (!hasGitRepo(identity)) {
    return respond(
      ctx,
      `no memory repository for ${identity.identity} at ${identity.identityPaths.repo}; run /memfs init or /init to create one`,
      "error",
    )
  }
  const only = classesOf(parsed.flags.get("only"))
  if (typeof only === "string") return respond(ctx, `${only}\n${MEMORY_CLEANUP_USAGE}`, "error")
  const skip = listOf(parsed.flags.get("skip"))
  const apply = parsed.flags.get("apply") === true
  const json = parsed.flags.get("json") === true
  const now = deps.now?.()
  const plan = await planMemoryCleanup(identity.identityPaths.repo, {
    ...(now === undefined ? {} : { now }),
    includeLoadBearing: parsed.flags.get("include-load-bearing") === true,
    ...(only === undefined ? {} : { only }),
    skip,
    budgetTokens: deps.loadSettings().settings.compile_warn_tokens,
  })
  if (!apply) return respond(ctx, json ? JSON.stringify(plan, null, 2) : renderMemoryCleanupReport(plan))

  const sessionId = sessionIdOf(ctx)
  try {
    const applied = await applyMemoryCleanup({
      repo: openRepo(deps, identity),
      lock: writerLock(identity),
      plan,
      author: { agentId: identity.identity, authorName: "Human" },
      ...(sessionId === undefined ? {} : { provenance: { sessionId, userTurns: 0 } }),
    })
    if (applied.applied) deps.bustPromptCache()
    return respond(
      ctx,
      json ? JSON.stringify({ plan, applied }, null, 2) : renderMemoryCleanupReport(plan, { applied }),
    )
  } catch (error) {
    return respond(ctx, error instanceof Error ? error.message : String(error), "error")
  }
}

function classesOf(raw: string | true | undefined): readonly MemoryCleanupClass[] | string | undefined {
  if (raw === undefined) return undefined
  if (raw === true) return "--only needs a comma-separated list of classes"
  const classes: MemoryCleanupClass[] = []
  for (const token of listOf(raw)) {
    const cls = MEMORY_CLEANUP_CLASSES.find((candidate) => candidate === token)
    if (cls === undefined) return `unknown cleanup class "${token}"`
    classes.push(cls)
  }
  return classes.length === 0 ? "--only needs at least one class" : classes
}

function listOf(raw: string | true | undefined): string[] {
  return typeof raw === "string"
    ? raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function writerLock(identity: MemoryCommandIdentity): MemoryWriteLock {
  return async (domain, operation) => {
    if (domain !== "memory-write") throw new Error(`unsupported lock domain '${domain}'`)
    const record = await createLockRecord(`/memory cleanup (${identity.identity})`)
    return withLock(memoryWriterLockPath(identity.identityPaths.locks), record, operation, { waitTimeoutMs: 5_000 })
  }
}
