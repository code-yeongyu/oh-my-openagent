import { join } from "node:path"

import { mkdir, readFile } from "../fs/resilient"
import { LockContentionError, createLockRecord, reflectionSchedulerLockPath, withLock } from "../locks"
import { recordReflectionRunIdMark, scanReflectionRunHighWater } from "../reflection/run-id-high-water"
import type { RetentionContext } from "./policy"

export interface ReflectionRetentionGuard {
  /** The highest run number on disk (H1 Guard 1): the trace carrying it is never removed. */
  readonly highWater: number
  readonly reserved: ReadonlySet<string>
  /** Conversations named by `active.lock`/`pending.json` (J0): their journals are never touched. */
  readonly reservedConversationIds: ReadonlySet<string>
}

/**
 * Reads the reservation state and the run-id high water under the `reflection-scheduler` lock, the
 * lock the allocator mints under, and raises the durable `run-id.json` mark before anything is
 * removed (H1 Guard 2). Contention means a reservation is in progress: the reflection stores are
 * skipped for this pass rather than waited on.
 */
export async function readReflectionRetentionGuard(
  context: RetentionContext,
): Promise<ReflectionRetentionGuard | undefined> {
  await mkdir(context.paths.locks, { recursive: true, mode: 0o700 })
  const record = await createLockRecord("reflection-scheduler", { runId: "runtime-retention" })
  try {
    return await withLock(
      reflectionSchedulerLockPath(context.paths.locks),
      record,
      async () => {
        const highWater = await scanReflectionRunHighWater(context.paths)
        if (highWater > 0) await recordReflectionRunIdMark(context.paths.reflection, highWater)
        const reservations = await readReservations(context.paths.reflection)
        return { highWater, reserved: reservations.runIds, reservedConversationIds: reservations.conversationIds }
      },
      { waitTimeoutMs: 0 },
    )
  } catch (error) {
    if (error instanceof LockContentionError) return undefined
    throw error
  }
}

/** Run ids named by `active.lock` and `pending.json`, read raw; an unreadable file names nothing. */
export async function reservedRunIds(reflectionDir: string): Promise<ReadonlySet<string>> {
  return (await readReservations(reflectionDir)).runIds
}

/** Run ids and conversation ids named by `active.lock` and `pending.json`, read lock-free (the doctors' estimate). */
export async function readReservations(
  reflectionDir: string,
): Promise<{ readonly runIds: Set<string>; readonly conversationIds: Set<string> }> {
  const runIds = new Set<string>()
  const conversationIds = new Set<string>()
  for (const name of ["active.lock", "pending.json"]) {
    const record = await readFile(join(reflectionDir, name), "utf8")
      .then(
        (raw) =>
          JSON.parse(raw) as { readonly runId?: unknown; readonly request?: { readonly conversationIds?: unknown } },
      )
      .catch(() => undefined)
    if (typeof record?.runId === "string") runIds.add(record.runId)
    const ids = record?.request?.conversationIds
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") conversationIds.add(id)
  }
  return { runIds, conversationIds }
}

/**
 * The guard taken only when a lock-free scan found a candidate (R3): a visit of an identity with
 * nothing to remove takes no lock and writes nothing, so a repo-less identity's mtimes stay as they
 * were and the transient sweep still reclaims it. The first call takes the scheduler lock once.
 */
export class LazyRetentionGuard {
  private pending: Promise<ReflectionRetentionGuard | undefined> | undefined
  value: ReflectionRetentionGuard | undefined
  busy = false

  constructor(private readonly context: RetentionContext) {}

  async get(): Promise<ReflectionRetentionGuard | undefined> {
    this.pending ??= readReflectionRetentionGuard(this.context).then((guard) => {
      this.value = guard
      this.busy = guard === undefined
      return guard
    })
    return this.pending
  }
}
