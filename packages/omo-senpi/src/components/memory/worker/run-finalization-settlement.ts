import { join } from "node:path"

import {
  ensureReflectionCompletion,
  readReflectionCompletion,
} from "./completion"
import { readReflectionHealth } from "./health"
import {
  readRunJson,
  updateRunLedger,
  writeRunJsonAtomic,
} from "./run-artifacts"
import type {
  DurableFinalizationDecision,
  ReservationRunResult,
  RunFinalizationContext,
} from "./run-finalization-types"
import {
  parseReservationRunLedger,
  type ReservationRunLedger,
} from "./reservation-run-ledger"

export async function settleReservationRun(
  context: RunFinalizationContext,
  runDir: string,
  inputLedger: ReservationRunLedger,
  decision: DurableFinalizationDecision,
): Promise<ReservationRunResult> {
  const ledgerPath = join(runDir, "ledger.json")
  const current = parseReservationRunLedger(await readRunJson<unknown>(ledgerPath))
  if (current.runId !== inputLedger.runId) throw new Error("Finalization ledger run id changed")
  const finalizedAt = current.finalizedAt ?? new Date(context.now()).toISOString()
  await updateRunLedger(ledgerPath, {
    finalizeOutcome: decision.outcome,
    ...(decision.reason === undefined ? {} : { finalizeReason: decision.reason }),
    ...(decision.detail === undefined ? {} : { finalizeDetail: decision.detail }),
    ...(decision.integrationSha === undefined ? {} : { integrationSha: decision.integrationSha }),
    finalizedAt,
  })

  const active = (await context.reservation.readState()).active
  const completionsDir = join(context.identity.paths.reflection, "completions")
  const existing = await readReflectionCompletion(completionsDir, current.runId)
  const category = current.category ?? existing?.category
  const conversationIds = current.conversationIds
    ?? (active?.runId === current.runId ? active.request.conversationIds : undefined)
    ?? existing?.conversationIds
    ?? await readLegacyConversationIds(runDir)
  if (category === undefined || conversationIds === undefined) {
    throw new Error(`Reflection completion identity unavailable for ${current.runId}`)
  }
  let launch
  if (active?.runId === current.runId) {
    const transition = await context.reservation.complete(current.runId, decision.outcome)
    if (transition.launch !== undefined) context.launch?.(transition.launch)
    launch = transition.launch
  }

  const healthBefore = await readReflectionHealth(completionsDir)
  const completion = await ensureReflectionCompletion(completionsDir, {
    schemaVersion: 1,
    runId: current.runId,
    identity: context.identity.id,
    category,
    ...(current.model === undefined ? {} : { model: current.model }),
    ...(current.thinking === undefined ? {} : { thinking: current.thinking }),
    conversationIds,
    trigger: current.trigger,
    ...(current.origin === undefined ? {} : { origin: current.origin }),
    outcome: decision.outcome,
    ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    ...(decision.detail === undefined ? {} : { detail: decision.detail }),
    startedAt: current.startedAt,
    finishedAt: finalizedAt,
    durationMs: Math.max(0, Date.parse(finalizedAt) - Date.parse(current.startedAt)),
    ...(decision.outcome === "merged" && decision.integrationSha !== undefined
      ? { mergedCommitSha: decision.integrationSha }
      : {}),
    ...(current.validatedChangedPaths === undefined ? {} : { filesChanged: current.validatedChangedPaths.length }),
    consecutiveFailures: decision.outcome === "failed" ? healthBefore.streak + 1 : 0,
    delivery: { status: "pending" },
  })
  await updateRunLedger(ledgerPath, { finalizePhase: "settled" })
  await writeRunJsonAtomic(join(runDir, "final.json"), {
    version: 1,
    runId: current.runId,
    outcome: decision.outcome,
    finishedAt: finalizedAt,
    ...(decision.integrationSha === undefined ? {} : { integrationSha: decision.integrationSha }),
  })
  return {
    runId: current.runId,
    outcome: decision.outcome,
    ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    ...(decision.detail === undefined ? {} : { detail: decision.detail }),
    completion,
    ...(launch === undefined ? {} : { launch }),
  }
}

async function readLegacyConversationIds(
  runDir: string,
): Promise<readonly string[] | undefined> {
  try {
    const payload = await readRunJson<Record<string, unknown>>(join(runDir, "transcript-payload.json"))
    const request = payload.request
    if (request === null || typeof request !== "object" || Array.isArray(request)) return undefined
    const ids = (request as Record<string, unknown>).conversationIds
    return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : undefined
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}
