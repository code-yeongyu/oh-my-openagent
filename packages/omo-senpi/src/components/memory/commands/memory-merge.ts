// /memory-merge [--apply] (#10070): bring the stores of old identities (one per Desktop thread worktree or
// per directory spelling) into the identity `git` mode resolves for this repository. Without --apply it only
// reports; --apply merges each store in one commit under the memory-write lock and never edits system/.

import { dirname } from "node:path"

import {
  applyIdentityMerge,
  buildDefaultSeedFiles,
  createLockRecord,
  findMergePredecessors,
  installHooks,
  memoryWriterLockPath,
  planIdentityMerge,
  readIdentityRecord,
  repositoryCandidateDirs,
  resolveAutoIdentity,
  withLock,
  type MemoryWriteLock,
  type MergePlan,
} from "@oh-my-opencode/memory-core"

import { memoryHookChecker } from "../worker/spawn-supervisor-support"
import { LAZY_MEMORY_COMMANDS, type MemoryCommandPort } from "./metadata"
import {
  requireIdentity,
  respond,
  type MemoryCommandContext,
  type MemoryCommandDeps,
  type MemoryCommandIdentity,
} from "./types"

const MEMORY_MERGE_USAGE = "usage: /memory-merge [--apply]"

export function registerMemoryMergeCommand(pi: MemoryCommandPort, deps: MemoryCommandDeps): void {
  pi.registerCommand("memory-merge", {
    ...LAZY_MEMORY_COMMANDS["memory-merge"],
    handler: (args: string, ctx: MemoryCommandContext) => runMemoryMerge(deps, args, ctx),
  })
}

async function runMemoryMerge(deps: MemoryCommandDeps, args: string, ctx: MemoryCommandContext): Promise<string> {
  const tokens = args
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "")
  if (tokens.some((token) => token !== "--apply")) return respond(ctx, MEMORY_MERGE_USAGE, "error")
  const apply = tokens.includes("--apply")
  const identity = requireIdentity(deps, ctx)
  if (typeof identity === "string") return respond(ctx, identity, "error")

  const memoryRoot = dirname(dirname(identity.identityPaths.root))
  const env = { ...(deps.env ?? process.env), OMO_MEMORY_HOME: memoryRoot }
  // The mode the user configured: with `auto_identity: "path"` pinned, subfolder stores are kept on purpose.
  const mode = deps.loadSettings().settings.auto_identity
  const resolve = (spelling: string): string => resolveAutoIdentity(spelling, env, mode).id
  const spellings = (await readIdentityRecord(identity.identityPaths.root).catch(() => undefined))?.spellings ?? []
  const found = await findMergePredecessors(
    memoryRoot,
    identity.identity,
    resolve,
    await repositoryCandidateDirs(spellings),
  )
  const unmapped =
    found.unmapped.length === 0 ? [] : [`left alone (no recorded directory maps here): ${found.unmapped.join(", ")}`]
  if (found.predecessors.length === 0) {
    return respond(ctx, [`no other memory store maps to ${identity.identity}`, ...unmapped].join("\n"))
  }

  if (!apply) {
    const lines = await Promise.all(
      found.predecessors.map(async (predecessor) =>
        describePlan(
          await planIdentityMerge(
            predecessor.paths,
            identity.identityPaths,
            predecessor.mergedInto === identity.identity ? predecessor.mergedHead : undefined,
          ),
        ),
      ),
    )
    return respond(
      ctx,
      [
        `${found.predecessors.length} memory store(s) map to ${identity.identity} (dry run, nothing changed):`,
        ...lines,
        ...unmapped,
        "run /memory-merge --apply to merge them; each merge is one commit you can revert",
      ].join("\n"),
    )
  }

  const lock = writerLock(identity)
  const results: string[] = []
  let merged = false
  for (const predecessor of found.predecessors) {
    try {
      const result = await applyIdentityMerge({
        source: predecessor.paths,
        target: identity.identityPaths,
        lock,
        author: { agentId: identity.identity, authorName: "Human" },
        // Same bootstrap as a first memory write (engine-session.ts), so a store the merge creates has its seeds and hooks.
        initTarget: (repo) =>
          repo.init({
            seedFiles: buildDefaultSeedFiles(),
            installHooks: (dir) => {
              installHooks(dir, { checker: memoryHookChecker() })
            },
          }),
      })
      if (result.status === "merged") {
        merged = true
        results.push(`merged ${predecessor.id} (${result.sha.slice(0, 7)}): ${counts(result.plan)}`)
      } else {
        results.push(`${predecessor.id}: ${result.status === "already-merged" ? "already merged" : "nothing to merge"}`)
      }
    } catch (error) {
      results.push(`${predecessor.id}: skipped (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  if (merged) deps.bustPromptCache()
  return respond(ctx, [...results, ...unmapped].join("\n"))
}

function describePlan(plan: MergePlan): string {
  return `- ${plan.sourceId}: ${counts(plan)}`
}

function counts(plan: MergePlan): string {
  const tally = { add: 0, "keep-aside": 0, skip: 0 }
  for (const action of plan.actions) tally[action.action] += 1
  return `${tally.add} to add, ${tally["keep-aside"]} kept aside under reference/merged/${plan.sourceId}/, ${tally.skip} identical`
}

function writerLock(identity: MemoryCommandIdentity): MemoryWriteLock {
  return async (domain, operation) => {
    if (domain !== "memory-write") throw new Error(`unsupported lock domain '${domain}'`)
    const record = await createLockRecord(`/memory-merge (${identity.identity})`)
    return withLock(memoryWriterLockPath(identity.identityPaths.locks), record, operation, { waitTimeoutMs: 5_000 })
  }
}
