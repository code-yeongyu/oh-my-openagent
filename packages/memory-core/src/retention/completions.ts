// Consumed completion records (`reflection/completions/<runId>.json`, design 2.2). They are the
// allocator's durable trace of a finished run, so nothing is removed until `run-id.json` covers the
// record's number (H1 Guard 2), and the high-water record itself is never removed (Guard 1).

import { join } from "node:path"

import { existsSync, readFile, rm } from "../fs/resilient"
import { readReflectionRunIdMark, reflectionRunNumber } from "../reflection/run-id-high-water"
import type { LazyRetentionGuard } from "./guard"
import { DAY_MS, StoreTally, listNames, type RetentionContext, type RetentionStoreResult } from "./policy"

/** `readReflectionHealth` reads the latest records for its streak and last-success window. */
export const COMPLETIONS_KEEP_NEWEST = 50

type Completion = { readonly runId: string; readonly finishedAt: number; readonly consumed: boolean }

export async function pruneCompletions(context: RetentionContext, lazyGuard: LazyRetentionGuard): Promise<RetentionStoreResult> {
  const dir = join(context.paths.reflection, "completions")
  const tally = new StoreTally()
  const records: Completion[] = []
  for (const name of await listNames(dir)) {
    if (!name.endsWith(".json")) continue
    // Classifying reads metadata only: it stops on the abort signal, never on the time budget.
    if (context.budget?.proceed("completions") === false) return tally.result()
    const runId = name.slice(0, -".json".length)
    const record = await readCompletion(join(dir, name), runId)
    if (record === undefined) tally.keep(runId, "malformed")
    else records.push(record)
  }
  const newestFirst = [...records].sort((left, right) => right.finishedAt - left.finishedAt || (left.runId < right.runId ? 1 : -1))
  const newest = new Set(newestFirst.slice(0, COMPLETIONS_KEEP_NEWEST).map((record) => record.runId))
  records.sort((left, right) => (left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0))
  const cutoff = context.now() - context.policy.completionsDays * DAY_MS
  for (const record of records) {
    if (context.budget?.skip("completions", record.runId) === true) continue
    if (context.budget?.admit("completions") === false) break
    const number = reflectionRunNumber(record.runId)
    if (newest.has(record.runId)) tally.keep(record.runId, "newest")
    else if (!record.consumed) tally.keep(record.runId, "pending-delivery")
    else if (record.finishedAt > cutoff) tally.keep(record.runId, "recent")
    else if (existsSync(join(context.paths.reflection, "runs", record.runId))) tally.keep(record.runId, "run-present")
    else {
      const guarded = await keepByGuard(context, lazyGuard, number)
      if (guarded !== undefined) tally.keep(record.runId, guarded)
      else {
        await rm(join(dir, `${record.runId}.json`), { force: true })
        tally.removed.push(record.runId)
      }
    }
    context.budget?.done("completions", record.runId)
  }
  return tally.result()
}

/** The mark is read only after the guard recorded it (H1 Guard 2): no mark, no removal. */
async function keepByGuard(context: RetentionContext, lazyGuard: LazyRetentionGuard, number: number): Promise<"scheduler-busy" | "no-mark" | "anchor" | undefined> {
  const guard = await lazyGuard.get()
  if (guard === undefined) return "scheduler-busy"
  const mark = await readReflectionRunIdMark(context.paths.reflection)
  if (mark === undefined || number === 0 || number > mark) return "no-mark"
  if (number === guard.highWater) return "anchor"
  return undefined
}

export async function readCompletion(path: string, runId: string): Promise<Completion | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    const delivery = record.delivery as { readonly status?: unknown } | undefined
    const finishedAt = typeof record.finishedAt === "string" ? Date.parse(record.finishedAt) : Number.NaN
    if (record.schemaVersion !== 1 || record.runId !== runId || Number.isNaN(finishedAt)) return undefined
    if (delivery?.status !== "pending" && delivery?.status !== "consumed") return undefined
    return { runId, finishedAt, consumed: delivery.status === "consumed" }
  } catch {
    return undefined
  }
}
