import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import { validateCompletion } from "@oh-my-opencode/memory-core"

import { emitMemoryReceipt, runReceipt } from "../receipts-port"
import {
  CHILD_EXIT_FILENAME,
  readRunJson,
  readRunTextTail,
  runOutcomeMatchesLedger,
  updateRunLedger,
  writeRunJsonAtomic,
  type RunChildExit,
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
  worktreeFromLedger,
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
  options: { readonly recovered?: boolean } = {},
): Promise<ReservationRunResult | undefined> {
  const claimed = await withRunFinalizationClaim(
    context.identity,
    runDir,
    ledger.runId,
    async () => {
      if (options.recovered === true) await emitRecovered(context, ledger)
      return finalizeClaimedOutcome(context, runDir, ledger.runId)
    },
  )
  return claimedValue(claimed)
}

/**
 * A supervisor that died after its child exited never published `outcome.json`. Recovery trusts the
 * child's tip only when the bootstrap durably recorded that this attempt's child exited 0, by
 * itself, before the hard deadline, and the tip passes the same validation a successful child's tip
 * passes. The outcome then carries that recorded exit, marked `recoveredFromWorktree`, so the normal
 * validate, merge and settle path takes it. Anything less returns false and writes nothing.
 */
export async function recoverUnpublishedWorktreeTip(
  context: RunFinalizationContext,
  runDir: string,
  ledger: ReservationRunLedger,
): Promise<boolean> {
  if (existsSync(join(runDir, "outcome.json"))) return false
  const exit = await readCleanChildExit(runDir, ledger)
  if (exit === undefined) return false
  const worktree = worktreeFromLedger(context.identity, ledger)
  if (!existsSync(worktree.dir)) return false
  const validation = await validateCompletion(worktree, ledger.baseSha, worktree.exec)
  if (validation.status !== "valid") return false
  const outcome: RunOutcome = {
    version: 1,
    runId: ledger.runId,
    ...(ledger.attempt === undefined ? {} : { attempt: ledger.attempt }),
    finishedAt: exit.finishedAt,
    childExit: { code: exit.code, signal: exit.signal },
    timedOut: false,
    recoveredFromWorktree: true,
  }
  await writeRunJsonAtomic(join(runDir, "outcome.json"), outcome)
  await emitRecovered(context, ledger)
  return true
}

async function readCleanChildExit(runDir: string, ledger: ReservationRunLedger): Promise<RunChildExit | undefined> {
  let exit: unknown
  try {
    exit = await readRunJson<unknown>(join(runDir, CHILD_EXIT_FILENAME))
  } catch {
    return undefined
  }
  if (typeof exit !== "object" || exit === null) return undefined
  const record = exit as Partial<RunChildExit>
  if (typeof record.finishedAt !== "string") return undefined
  const finishedAt = Date.parse(record.finishedAt)
  const startedAt = Date.parse(ledger.startedAt)
  const clean = record.runId === ledger.runId && record.attempt === ledger.attempt
    && record.code === 0 && record.signal === null && record.timedOut === false
    && Number.isFinite(finishedAt) && Number.isFinite(startedAt)
    && finishedAt >= startedAt && finishedAt < ledger.hardDeadlineAt
  return clean ? record as RunChildExit : undefined
}

async function emitRecovered(context: RunFinalizationContext, ledger: ReservationRunLedger): Promise<void> {
  await emitMemoryReceipt(context.identity.paths.runtime, runReceipt(ledger, "recovered"), context.receipts, context.warn)
}

export async function failReservationRun(
  context: RunFinalizationContext,
  runDir: string,
  ledger: ReservationRunLedger,
  outcome: "failed" | "timed_out",
  detail?: string,
  options: { readonly recoverWorktreeTip?: boolean } = {},
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
      if (options.recoverWorktreeTip === true && await recoverUnpublishedWorktreeTip(context, runDir, current)) {
        return finalizeClaimedOutcome(context, runDir, current.runId)
      }
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
const RECOVERED_DETAIL = "recovered from the worktree tip after the supervisor died before publishing an outcome"

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
        generation: precedence.ledger.startedAt,
      })
      await emitMemoryReceipt(
        context.identity.paths.runtime,
        runReceipt(precedence.ledger, "abandoned", { reason: "abandoned_unknown" }),
        context.receipts,
        context.warn,
      )
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
  return settleReservationRun(context, runDir, ledger, outcome.recoveredFromWorktree === true
    ? { ...decision, recoveredFromWorktree: true, detail: [decision.detail, RECOVERED_DETAIL].filter(Boolean).join("\n") }
    : decision)
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
