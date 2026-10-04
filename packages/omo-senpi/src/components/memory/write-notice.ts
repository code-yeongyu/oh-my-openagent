import { createNodeGitExec, type MemoryToolCommit } from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"
import type { MemoryRpcSnapshot } from "./memory-rpc-bridge"
import { buildMemorySnapshot, createMemoryRpcGitRepo } from "./memory-rpc-snapshot-state"
import type { MemoryToolsOptions, MemoryWriteNotice, MemoryWriteAffectedFile } from "./tools"

/**
 * Gathering is DECORATION for the visible row: it runs only behind the gate, only after a real
 * commit, and it can never fail the tool result, so the whole call is wrapped once more here on
 * top of the per-field guards inside `gatherMemoryWriteNotice`.
 */
export async function writeNoticeFor(
  context: MemoryIdentityContext,
  commit: MemoryToolCommit | undefined,
  options: MemoryToolsOptions,
): Promise<MemoryWriteNotice | undefined> {
  if (commit === undefined || options.writeNotice?.enabled !== true) return undefined
  try {
    const sessionId = options.writeNotice.resolveSessionId?.()
    // Bounded: a wedged git or filesystem probe degrades the row, it never holds the tool result.
    return await Promise.race([
      gatherMemoryWriteNotice(context, commit, sessionId === undefined ? {} : { sessionId }),
      new Promise<undefined>((resolve) => {
        setTimeout(resolve, WRITE_NOTICE_BUDGET_MS).unref?.()
      }),
    ])
  } catch {
    return undefined
  }
}

/** Whole-gather budget; the row is decoration, so it yields to the result long before git does. */
const WRITE_NOTICE_BUDGET_MS = 3_000

export interface MemoryWriteNoticeDeps {
  /** Bound session id; without one the journal-derived unreflected-step count is unavailable. */
  readonly sessionId?: string
  /** Snapshot seam; production reuses the RPC snapshot builder so the numbers cannot drift. */
  readonly buildSnapshot?: (context: MemoryIdentityContext, sessionId: string) => Promise<MemoryRpcSnapshot>
}

/**
 * Collects the raw post-commit facts behind the visible notice. Every source is probed
 * independently and every probe swallows its own failure: a broken git, a missing reflection
 * directory, or a corrupt journal state omits ONLY its own field.
 */
export async function gatherMemoryWriteNotice(
  context: MemoryIdentityContext,
  commit: MemoryToolCommit,
  deps: MemoryWriteNoticeDeps = {},
): Promise<MemoryWriteNotice> {
  const [affected, snapshot] = await Promise.all([
    readAffectedFiles(context.identityPaths.repo, commit.sha),
    readSnapshot(context, deps),
  ])
  const repo = snapshot?.repo
  const size = repo === undefined
      || repo.systemBytes === undefined
      || repo.totalBytes === undefined
      || repo.fileCount === undefined
    ? undefined
    : { systemBytes: repo.systemBytes, totalBytes: repo.totalBytes, fileCount: repo.fileCount }
  const unreflectedSteps = snapshot?.reflection.backlogSteps
  return {
    sha: commit.sha,
    subject: commit.subject,
    identity: context.identity,
    affected,
    ...(size === undefined ? {} : { size }),
    timeline: {
      ...(repo?.entriesToday === undefined ? {} : { entriesToday: repo.entriesToday }),
      ...(repo?.previousEntryAtISO === undefined ? {} : { previousEntryAtISO: repo.previousEntryAtISO }),
      ...(snapshot?.reflection.lastConsolidationAtISO === undefined
        ? {}
        : { lastConsolidationAtISO: snapshot.reflection.lastConsolidationAtISO }),
      ...(unreflectedSteps === undefined || unreflectedSteps <= 0 ? {} : { unreflectedSteps }),
    },
  }
}

async function readSnapshot(
  context: MemoryIdentityContext,
  deps: MemoryWriteNoticeDeps,
): Promise<MemoryRpcSnapshot | undefined> {
  const sessionId = deps.sessionId
  if (sessionId === undefined || sessionId.length === 0) return undefined
  try {
    if (deps.buildSnapshot !== undefined) return await deps.buildSnapshot(context, sessionId)
    return await buildMemorySnapshot(context, sessionId, {
      repo: createMemoryRpcGitRepo(context.identityPaths.repo),
      activeRun: () => undefined,
      tokenEstimates: new Map(),
      treeStats: new Map(),
    })
  } catch {
    return undefined
  }
}

/**
 * Per-path line counts from `git show --numstat -z <sha>`. The NUL-delimited form is used because
 * memory paths may contain characters git would otherwise quote; binary files report "-" counts
 * and are reported as zero rather than dropped.
 */
async function readAffectedFiles(repoPath: string, sha: string): Promise<readonly MemoryWriteAffectedFile[]> {
  try {
    const result = await createNodeGitExec().run(
      ["show", "--numstat", "-z", "--format=", sha],
      { cwd: repoPath, timeoutMs: NUMSTAT_TIMEOUT_MS },
    )
    if (result.code !== 0) return []
    return parseNumstat(result.stdout)
  } catch {
    return []
  }
}

const NUMSTAT_TIMEOUT_MS = 10_000

/**
 * `--numstat -z` emits `<ins>\t<del>\t<path>\0` per file, except for renames, which emit
 * `<ins>\t<del>\t\0<old>\0<new>\0` - the destination path is what the notice reports.
 */
export function parseNumstat(stdout: string): readonly MemoryWriteAffectedFile[] {
  const fields = stdout.split("\0")
  const affected: MemoryWriteAffectedFile[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (field === undefined || field.trim().length === 0) continue
    const parts = field.split("\t")
    if (parts.length < 3) continue
    const insertions = countOf(parts[0])
    const deletions = countOf(parts[1])
    let path = parts[2] ?? ""
    if (path.length === 0) {
      // Rename: the old path and the new path follow as their own NUL-terminated fields.
      path = fields[index + 2] ?? fields[index + 1] ?? ""
      index += 2
    }
    if (path.length === 0) continue
    affected.push({ path, insertions, deletions })
  }
  return affected
}

function countOf(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}
