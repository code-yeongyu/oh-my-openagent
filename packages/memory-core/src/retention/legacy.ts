// Stores no writer on dev touches any more (design 2.6): `recall/runs/` (last written 09-14) and
// `reflection-sessions/<runId>/` (last written 08-13, still scanned by the run-id allocator). The
// reflection-sessions directory itself stays because the sandbox grant expects it.

import { join } from "node:path"

import { existsSync } from "../fs/resilient"
import { removeTree } from "../fs/remove-tree"
import { reflectionRunNumber } from "../reflection/run-id-high-water"
import type { LazyRetentionGuard } from "./guard"
import { DAY_MS, StoreTally, describeError, idleSince, listNames, type RetentionContext, type RetentionStoreResult } from "./policy"

export type LegacyRecallRunsOutcome = "absent" | "kept" | "removed"

export async function pruneLegacyRecallRuns(context: RetentionContext): Promise<LegacyRecallRunsOutcome> {
  const dir = join(context.paths.recall, "runs")
  if (!existsSync(dir)) return "absent"
  if (context.budget?.skip("recall-runs", "runs") === true) return "kept"
  if (context.budget?.admit("recall-runs") === false) return "kept"
  if (!(await idleSince(dir, context.now() - context.policy.retentionDays * DAY_MS))) return "kept"
  await removeTree(dir)
  context.budget?.done("recall-runs", "runs")
  return "removed"
}

export async function pruneLegacyReflectionSessions(
  context: RetentionContext,
  lazyGuard: LazyRetentionGuard,
): Promise<RetentionStoreResult> {
  const tally = new StoreTally()
  const cutoff = context.now() - context.policy.retentionDays * DAY_MS
  for (const name of await listNames(context.paths.reflectionSessions)) {
    if (context.budget?.skip("reflection-sessions", name) === true) continue
    if (context.budget?.admit("reflection-sessions") === false) break
    const path = join(context.paths.reflectionSessions, name)
    const guard = (await idleSince(path, cutoff)) ? await lazyGuard.get() : undefined
    if (!(await idleSince(path, cutoff))) tally.keep(name, "recent")
    else if (guard === undefined) tally.keep(name, "scheduler-busy")
    else if (reflectionRunNumber(name) === guard.highWater) tally.keep(name, "anchor")
    else {
      try {
        await removeTree(path)
        tally.removed.push(name)
      } catch (error) {
        context.warn?.("memory runtime retention could not remove a legacy reflection session", { path, error: describeError(error) })
        tally.keep(name, "changed-during-removal")
      }
    }
    context.budget?.done("reflection-sessions", name)
  }
  return tally.result()
}
