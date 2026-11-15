import { join } from "node:path"

import { readFile, stat, unlink } from "../fs/resilient"
import { TranscriptJournal } from "../journal/store"
import { createLockRecord } from "../locks/lock-record"
import { reflectionSchedulerLockPath } from "../locks/domains"
import { withLock } from "../locks/acquire"
import { ReflectionParkFile } from "./park-file"
import { readRun } from "./reservation-files"

export interface ReleaseWithoutPromotionOptions {
  readonly reflectionDir: string
  readonly transcriptsDir: string
  readonly locksDir: string
  readonly runId: string
  readonly now?: () => Date
}

export interface ReleaseWithoutPromotionResult {
  readonly released: boolean
  readonly pendingRunId?: string
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

async function readPendingRunId(reflectionDir: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(reflectionDir, "pending.json"), "utf8"))
    const runId =
      typeof parsed === "object" && parsed !== null ? (parsed as { readonly runId?: unknown }).runId : undefined
    return typeof runId === "string" ? runId : undefined
  } catch (error) {
    if (errorCode(error) === "ENOENT" || error instanceof SyntaxError) return undefined
    throw error
  }
}

/**
 * Releases `runId`'s reservation as a failure WITHOUT promoting `pending.json` (DESIGN.r2 4.1b, H3).
 * `complete()` would promote the pending run under the caller's pid; from the CLI that pid exits at
 * once and the promoted run would itself be reaped as an interrupted launch. This applies the same
 * failure bookkeeping as a `failed` completion, never writes `pending.json`, and unlinks `active.lock`.
 * The next session promotes the pending run under its own pid (`ReflectionReservationStore.promotePending`).
 * Lock contention throws `LockContentionError` (the scheduler lock is taken with `waitTimeoutMs: 0`).
 */
export async function releaseReservationWithoutPromotion(
  options: ReleaseWithoutPromotionOptions,
): Promise<ReleaseWithoutPromotionResult> {
  const now = options.now ?? (() => new Date())
  const record = await createLockRecord("reflection-scheduler", { runId: options.runId })
  return withLock(
    reflectionSchedulerLockPath(options.locksDir),
    record,
    async () => {
      const activePath = join(options.reflectionDir, "active.lock")
      const active = await readRun(activePath)
      if (active?.runId !== options.runId) return { released: false }
      if (active.request.trigger !== "manual" && active.request.trigger !== "dream") {
        for (const conversationId of active.request.conversationIds) {
          const journalDir = join(options.transcriptsDir, conversationId)
          if (
            !(await stat(journalDir).then(
              (status) => status.isDirectory(),
              () => false,
            ))
          )
            continue
          await new TranscriptJournal({ journalDir, now }).recordReflectionFailure()
        }
      }
      await new ReflectionParkFile(options.reflectionDir, now).transition(active, options.runId, "failed", undefined)
      const pendingRunId = await readPendingRunId(options.reflectionDir)
      await unlink(activePath)
      return { released: true, ...(pendingRunId === undefined ? {} : { pendingRunId }) }
    },
    { waitTimeoutMs: 0 },
  )
}
