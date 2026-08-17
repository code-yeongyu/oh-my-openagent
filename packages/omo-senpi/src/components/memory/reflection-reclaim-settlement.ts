import { join } from "node:path"

import type { MemoryIdentityPaths, ReflectionReclaimedReservation } from "@oh-my-opencode/memory-core"

import { ensureReflectionCompletion, readReflectionCompletion } from "./worker/completion"
import { readReflectionHealth } from "./worker/health"
import { parseReservationRunLedger } from "./worker/reservation-run-ledger"
import { readRunJson } from "./worker/run-artifacts"

const RECLAIM_REASON = "reservation_reclaimed"

export async function readRunDeadline(
  paths: MemoryIdentityPaths,
  runId: string,
): Promise<number | undefined> {
  try {
    const ledger = parseReservationRunLedger(
      await readRunJson<unknown>(join(paths.reflection, "runs", runId, "ledger.json")),
    )
    return ledger.deadlineAt
  } catch {
    return undefined
  }
}

// Freeing active.lock is not what stops the footer spinner: the animation is driven by the
// in-flight run registry, which only drains when a completion record for the run is consumed.
// A reclaimed run therefore has to publish its own failure record or it keeps reporting itself
// as reflecting forever, which is the symptom the reclaim exists to end.
export async function settleReclaimedReservation(input: {
  readonly identity: string
  readonly paths: MemoryIdentityPaths
  readonly reclaimed: ReflectionReclaimedReservation
  readonly now: () => Date
}): Promise<void> {
  const { reclaimed, paths } = input
  const runId = reclaimed.run.runId
  const completionsDir = join(paths.reflection, "completions")
  if (await readReflectionCompletion(completionsDir, runId) !== null) return
  const ledger = await readRunLedger(paths, runId)
  const finishedAt = input.now().toISOString()
  const startedAt = ledger?.startedAt ?? reclaimed.run.reservedAt ?? finishedAt
  const health = await readReflectionHealth(completionsDir)
  await ensureReflectionCompletion(completionsDir, {
    schemaVersion: 1,
    runId,
    identity: input.identity,
    category: ledger?.category ?? "quick",
    ...(ledger?.model === undefined ? {} : { model: ledger.model }),
    conversationIds: reclaimed.run.request.conversationIds,
    trigger: reclaimed.run.request.trigger,
    ...(reclaimed.run.request.trigger === "dream" ? { origin: reclaimed.run.request.origin } : {}),
    outcome: "failed",
    reason: RECLAIM_REASON,
    detail: reclaimed.detail ?? reclaimed.reason,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    consecutiveFailures: health.streak + 1,
    delivery: { status: "pending" },
  })
}

async function readRunLedger(
  paths: MemoryIdentityPaths,
  runId: string,
): Promise<{ startedAt: string; category?: string; model?: string } | undefined> {
  try {
    const ledger = parseReservationRunLedger(
      await readRunJson<unknown>(join(paths.reflection, "runs", runId, "ledger.json")),
    )
    return {
      startedAt: ledger.startedAt,
      ...(ledger.category === undefined ? {} : { category: ledger.category }),
      ...(ledger.model === undefined ? {} : { model: ledger.model }),
    }
  } catch {
    return undefined
  }
}
