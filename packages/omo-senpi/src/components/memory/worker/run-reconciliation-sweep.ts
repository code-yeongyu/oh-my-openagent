// Reconciliation only repairs runs that still own a run directory. Worktrees and branches from
// runs whose directory was already removed, or that died between `git worktree add` and the
// ledger write, survive every finalization path, so a reconciliation pass also sweeps them.
// Ownership is proven, never guessed: the reservation's active/pending runs and every
// non-terminal run directory are live, and anything younger than the grace window is left alone.

import { existsSync, readdir } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  GitMemoryRepo,
  LockContentionError,
  REFLECTION_ORPHAN_GRACE_MS,
  sweepReflectionOrphans,
  type MemoryIdentity,
} from "@oh-my-opencode/memory-core"

import type { ReservationStatePort } from "./run-finalization"

export interface ReflectionSweepLogger {
  warn(message: string, details?: Record<string, unknown>): void
}

export interface ReflectionOrphanSweepContext {
  readonly identity: MemoryIdentity
  readonly reservation: ReservationStatePort
  readonly now: () => number
  readonly logger?: ReflectionSweepLogger
  readonly deferOnSchedulerContention?: boolean
}

export async function sweepReflectionRunOrphans(context: ReflectionOrphanSweepContext): Promise<void> {
  let liveRunIds: ReadonlySet<string>
  try {
    liveRunIds = await collectLiveRunIds(context)
  } catch (error) {
    if (context.deferOnSchedulerContention && error instanceof LockContentionError) return
    throw error
  }
  const repo = new GitMemoryRepo({ dir: context.identity.paths.repo, agentId: context.identity.id })
  try {
    const receipts = await sweepReflectionOrphans(repo, context.identity.paths.worktrees, {
      liveRunIds,
      now: context.now(),
      graceMs: REFLECTION_ORPHAN_GRACE_MS,
    })
    for (const receipt of receipts) {
      context.logger?.warn(
        receipt.removed ? "Discarded an orphaned reflection leftover" : "Could not discard an orphaned reflection leftover",
        {
          kind: receipt.kind,
          target: receipt.target,
          ...(receipt.detail === undefined ? {} : { detail: receipt.detail }),
        },
      )
    }
  } catch (error) {
    // Leftovers are maintenance, never a reason to fail the pass that repairs live runs.
    context.logger?.warn("Reflection orphan sweep failed", {
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

async function collectLiveRunIds(context: ReflectionOrphanSweepContext): Promise<ReadonlySet<string>> {
  const state = await context.reservation.readState(
    context.deferOnSchedulerContention ? { waitTimeoutMs: 0 } : undefined,
  )
  const live = new Set<string>()
  if (state.active !== undefined) live.add(state.active.runId)
  if (state.pending !== undefined) live.add(state.pending.runId)
  const runsDir = join(context.identity.paths.reflection, "runs")
  for (const runId of await runDirectoryNames(runsDir)) {
    const runDir = join(runsDir, runId)
    if (existsSync(join(runDir, "final.json")) || existsSync(join(runDir, "abandoned.json"))) continue
    // prelaunch.json is written before the worktree exists, so it claims the directory early.
    if (!existsSync(join(runDir, "ledger.json")) && !existsSync(join(runDir, "prelaunch.json"))) continue
    live.add(runId)
  }
  return live
}

async function runDirectoryNames(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}
