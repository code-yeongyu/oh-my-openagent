import { basename, join } from "node:path"

import { readdir, readFile, stat } from "../fs/resilient"
import { GitMemoryRepo } from "../git"
import {
  listReflectionLeftovers,
  REFLECTION_ORPHAN_GRACE_MS,
  selectReflectionOrphans,
  sweepReflectionOrphans,
} from "./orphan-sweep"

const TERMINAL_SENTINELS = ["final.json", "abandoned.json", "quarantined.json"] as const

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function reservedRunId(path: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    const runId =
      typeof parsed === "object" && parsed !== null ? (parsed as { readonly runId?: unknown }).runId : undefined
    return typeof runId === "string" ? runId : undefined
  } catch {
    return undefined
  }
}

/**
 * The runs a worktree may still belong to, read the way session reconcile reads them: the reserved
 * runs, plus every run dir with a ledger or prelaunch file and no terminal sentinel (a quarantined run
 * is terminal, REVIEW-1 M2).
 */
async function collectReflectionLiveRunIds(reflectionDir: string): Promise<ReadonlySet<string>> {
  const live = new Set<string>()
  for (const name of ["active.lock", "pending.json"]) {
    const runId = await reservedRunId(join(reflectionDir, name))
    if (runId !== undefined) live.add(runId)
  }
  const runsDir = join(reflectionDir, "runs")
  const names = await readdir(runsDir).catch(() => [] as string[])
  for (const runId of names) {
    if (runId.startsWith(".")) continue
    const runDir = join(runsDir, runId)
    if ((await Promise.all(TERMINAL_SENTINELS.map((file) => exists(join(runDir, file))))).some(Boolean)) continue
    if ((await exists(join(runDir, "ledger.json"))) || (await exists(join(runDir, "prelaunch.json")))) live.add(runId)
  }
  return live
}

export interface IdentityOrphanSweepReport {
  readonly skipped?: "no-repo"
  readonly removed: readonly string[]
  readonly kept: ReadonlyArray<{ readonly target: string; readonly reason: string }>
  readonly failed: ReadonlyArray<{ readonly target: string; readonly detail: string }>
}

/**
 * The orphan worktree/branch sweep for one identity from outside a session (`omo doctor --fix`,
 * DESIGN.r2 6b): needs the identity's git repo; `dryRun` lists what would go and why the rest stays.
 */
export async function sweepIdentityOrphanWorktrees(
  identityRoot: string,
  options: { readonly now: number; readonly dryRun?: boolean },
): Promise<IdentityOrphanSweepReport> {
  const repoDir = join(identityRoot, "repo")
  if (!(await exists(join(repoDir, ".git")))) return { skipped: "no-repo", removed: [], kept: [], failed: [] }
  const runtimeDir = join(identityRoot, "runtime")
  const worktreesDir = join(runtimeDir, "worktrees")
  const repo = new GitMemoryRepo({ dir: repoDir, agentId: basename(identityRoot) })
  const liveRunIds = await collectReflectionLiveRunIds(join(runtimeDir, "reflection"))
  const selection = { liveRunIds, now: options.now, graceMs: REFLECTION_ORPHAN_GRACE_MS }
  const leftovers = await listReflectionLeftovers(repo, worktreesDir)
  const orphans = selectReflectionOrphans(leftovers, selection)
  const orphanTargets = new Set([
    ...orphans.registeredWorktrees.map((worktree) => worktree.dir),
    ...orphans.strayDirs,
    ...orphans.branches,
  ])
  const keptReason = (target: string): string =>
    [...liveRunIds].some((runId) => basename(target).endsWith(runId)) ? "live" : "grace"
  const kept = [
    ...leftovers.registeredWorktrees.map((worktree) => worktree.dir),
    ...leftovers.strayDirs,
    ...leftovers.branches,
  ]
    .filter((target) => !orphanTargets.has(target))
    .map((target) => ({ target, reason: keptReason(target) }))
  if (options.dryRun === true) return { removed: [...orphanTargets], kept, failed: [] }
  const receipts = await sweepReflectionOrphans(repo, worktreesDir, selection)
  return {
    removed: receipts.filter((receipt) => receipt.removed).map((receipt) => receipt.target),
    kept,
    failed: receipts
      .filter((receipt) => !receipt.removed)
      .map((receipt) => ({ target: receipt.target, detail: receipt.detail ?? "not removed" })),
  }
}
