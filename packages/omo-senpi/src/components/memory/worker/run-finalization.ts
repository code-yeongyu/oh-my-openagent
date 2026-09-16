import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  readRunJson,
  readRunTextTail,
  runOutcomeMatchesLedger,
  updateRunLedger,
  writeRunJsonAtomic,
  type RunOutcome,
} from "./run-artifacts"
import {
  withRunFinalizationClaim,
  type ClaimedRunResult,
} from "./run-finalization-claim"
import { cleanupAndRecord, resolveFinalizationDecision } from "./run-finalization-git"
import { settleReservationRun } from "./run-finalization-settlement"
import { withRunTerminalGate } from "./run-terminal-gate"
import { checkRunAbandonmentPrecedence } from "./run-terminal-precedence"
import type {
  DurableFinalizationDecision,
  ReservationRunResult,
  RunFinalizationContext,
} from "./run-finalization-types"
import {
  parseReservationRunLedger,
  type ReservationRunLedger,
} from "./reservation-run-ledger"

export type {
  ReservationRunResult,
  ReservationStatePort,
  RunFinalizationContext,
} from "./run-finalization-types"

export async function finalizeRecordedOutcome(
  context: RunFinalizationContext,
  runDir: string,
  ledger: ReservationRunLedger,
): Promise<ReservationRunResult | undefined> {
  const claimed = await withRunFinalizationClaim(
    context.identity,
    runDir,
    ledger.runId,
    async () => finalizeClaimedOutcome(context, runDir, ledger.runId),
  )
  return claimedValue(claimed)
}

export async function failReservationRun(
  context: RunFinalizationContext,
  runDir: string,
  ledger: ReservationRunLedger,
  outcome: "failed" | "timed_out",
  detail?: string,
): Promise<ReservationRunResult | undefined> {
  const claimed = await withRunFinalizationClaim(
    context.identity,
    runDir,
    ledger.runId,
    async () => withRunTerminalGate(runDir, ledger.runId, async () => {
      if (await readMatchingOutcome(runDir, ledger) !== undefined) {
        return finalizeClaimedOutcome(context, runDir, ledger.runId)
      }
      const current = await readLedger(runDir, ledger.runId)
      const described = await describeUnpublishedFailure(runDir, detail)
      const decision: DurableFinalizationDecision = {
        outcome,
        reason: outcome === "timed_out" ? "deadline_exceeded" : "supervisor_failed",
        ...(described === undefined ? {} : { detail: described }),
      }
      await checkpointFailure(runDir, decision)
      await cleanupAndRecord(context, current, runDir)
      return settleReservationRun(context, runDir, current, decision)
    }),
  )
  return claimedValue(claimed)
}

const CHILD_STDERR_TAIL_BYTES = 64 * 1024

/**
 * A run that dies without an outcome still usually left its cause in child-stderr.log; that
 * tail leads the detail so the health fingerprint keys on the cause, and the caller's
 * description of the dead processes follows it.
 */
async function describeUnpublishedFailure(runDir: string, detail: string | undefined): Promise<string | undefined> {
  const stderrTail = (await readRunTextTail(join(runDir, "child-stderr.log"), CHILD_STDERR_TAIL_BYTES)).trim()
  const parts = [stderrTail, detail?.trim() ?? ""].filter((part) => part.length > 0)
  return parts.length === 0 ? undefined : parts.join("\n")
}

export async function overrideFailedReservationRun(
  context: RunFinalizationContext,
  runDir: string,
  ledger: ReservationRunLedger,
  detail: string,
): Promise<ReservationRunResult | undefined> {
  const claimed = await withRunFinalizationClaim(
    context.identity,
    runDir,
    ledger.runId,
    async () => withRunTerminalGate(runDir, ledger.runId, async () => {
      const current = await readLedger(runDir, ledger.runId)
      const decision: DurableFinalizationDecision = {
        outcome: "failed",
        reason: "spawn_failed",
        detail,
      }
      await checkpointFailure(runDir, decision)
      await cleanupAndRecord(context, current, runDir)
      return settleReservationRun(context, runDir, current, decision)
    }),
  )
  return claimedValue(claimed)
}

export async function abandonReservationRun(
  context: RunFinalizationContext,
  runDir: string,
  ledger: ReservationRunLedger,
): Promise<ReservationRunResult | undefined> {
  const claimed = await withRunFinalizationClaim(
    context.identity,
    runDir,
    ledger.runId,
    async () => withRunTerminalGate(runDir, ledger.runId, async () => {
      if (await readMatchingOutcome(runDir, ledger) !== undefined) {
        return finalizeClaimedOutcome(context, runDir, ledger.runId)
      }
      const current = await readLedger(runDir, ledger.runId)
      const active = (await context.reservation.readState()).active
      if (await readMatchingOutcome(runDir, current) !== undefined) {
        return finalizeClaimedOutcome(context, runDir, current.runId)
      }
      const abandonedAt = new Date(context.now()).toISOString()
      const precedence = await checkRunAbandonmentPrecedence(runDir, current.runId, context)
      if (precedence.decision === "finalize") {
        return finalizeClaimedOutcome(context, runDir, precedence.ledger.runId)
      }
      if (precedence.decision === "veto") return undefined
      await writeRunJsonAtomic(join(runDir, "abandoned.json"), {
        version: 1,
        runId: precedence.ledger.runId,
        outcome: "abandoned_unknown",
        abandonedAt,
      })
      if (active?.runId === precedence.ledger.runId) {
        const transition = await context.reservation.complete(precedence.ledger.runId, "failed")
        if (transition.launch !== undefined) context.launch?.(transition.launch)
      }
      return { runId: precedence.ledger.runId, outcome: "abandoned_unknown" as const }
    }),
  )
  return claimedValue(claimed)
}

async function finalizeClaimedOutcome(
  context: RunFinalizationContext,
  runDir: string,
  runId: string,
): Promise<ReservationRunResult> {
  const ledger = await readLedger(runDir, runId)
  const outcome = await readRunJson<RunOutcome>(join(runDir, "outcome.json"))
  if (!runOutcomeMatchesLedger(ledger, outcome)) {
    throw new Error(`Run outcome attempt ${outcome.attempt ?? "legacy"} does not match ${ledger.attempt ?? "legacy"}`)
  }
  const decision = await resolveFinalizationDecision(context, runDir, ledger, outcome)
  return settleReservationRun(context, runDir, ledger, decision)
}

async function readLedger(runDir: string, runId: string): Promise<ReservationRunLedger> {
  const ledger = parseReservationRunLedger(await readRunJson<unknown>(join(runDir, "ledger.json")))
  if (ledger.runId !== runId) throw new Error(`Finalization ledger mismatch: ${runId}`)
  return ledger
}

async function readMatchingOutcome(
  runDir: string,
  ledger: ReservationRunLedger,
): Promise<RunOutcome | undefined> {
  const path = join(runDir, "outcome.json")
  if (!existsSync(path)) return undefined
  const outcome = await readRunJson<RunOutcome>(path)
  return runOutcomeMatchesLedger(ledger, outcome) ? outcome : undefined
}

async function checkpointFailure(
  runDir: string,
  decision: DurableFinalizationDecision,
): Promise<void> {
  await updateRunLedger(join(runDir, "ledger.json"), {
    finalizeOutcome: decision.outcome,
    ...(decision.reason === undefined ? {} : { finalizeReason: decision.reason }),
    ...(decision.detail === undefined ? {} : { finalizeDetail: decision.detail }),
  })
}

function claimedValue(
  claimed: ClaimedRunResult<ReservationRunResult | undefined>,
): ReservationRunResult | undefined {
  return claimed.status === "busy" ? undefined : claimed.value
}
