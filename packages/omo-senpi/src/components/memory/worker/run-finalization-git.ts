import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  cleanupReflectionWorktree,
  createLockRecord,
  integrateValidatedReflection,
  memoryWriterLockPath,
  probeLegacyAutoRunReceipt,
  probeReflectionIntegration,
  validateCompletion,
  validateDreamTokenBudget,
  withLock,
  type ReflectionOutcome,
  type ValidatedReflectionTip,
} from "@oh-my-opencode/memory-core"

import { estimateSystemTokens } from "../commands/tokens"
import {
  readRunJson,
  readRunTextTail,
  updateRunLedger,
  type RunOutcome,
} from "./run-artifacts"
import type {
  DurableFinalizationDecision,
  RunFinalizationContext,
} from "./run-finalization-types"
import {
  parseReservationRunLedger,
  worktreeFromLedger,
  type ReservationRunLedger,
} from "./reservation-run-ledger"

export async function resolveFinalizationDecision(
  context: RunFinalizationContext,
  runDir: string,
  inputLedger: ReservationRunLedger,
  child: RunOutcome,
): Promise<DurableFinalizationDecision> {
  const ledgerPath = join(runDir, "ledger.json")
  let ledger = parseReservationRunLedger(await readRunJson<unknown>(ledgerPath))
  if (ledger.runId !== inputLedger.runId || child.runId !== ledger.runId) {
    throw new Error("Finalization run id changed")
  }
  const succeeded = !child.timedOut && child.childExit.code === 0 && child.childExit.signal === null
  if (!succeeded) {
    const detail = (await readRunTextTail(join(runDir, "child-stderr.log"), 64 * 1024)).trim() || undefined
    const decision: DurableFinalizationDecision = {
      outcome: child.timedOut ? "timed_out" : "failed",
      reason: child.timedOut ? "deadline_exceeded" : "child_exit",
      ...(detail === undefined ? {} : { detail }),
    }
    await checkpointDecision(ledgerPath, decision)
    await cleanupOrThrow(context, ledger)
    return decision
  }
  const checkpointed = decisionFromLedger(ledger)
  if (checkpointed !== undefined) {
    await cleanupOrThrow(context, ledger)
    return checkpointed
  }

  const worktree = worktreeFromLedger(context.identity, ledger)
  let validated = validatedFromLedger(ledger)
  if (validated === undefined && existsSync(worktree.dir)) {
    const validation = await validateCompletion(worktree, ledger.baseSha, worktree.exec)
    if (validation.status === "valid") {
      if (ledger.targetDoc !== undefined
        && validation.changedPaths.some((path) => path !== ledger.targetDoc)) {
        const decision = { outcome: "failed" as const, reason: "invalid_target", detail: "Dream changed paths outside targetDoc" }
        await checkpointDecision(ledgerPath, decision)
        await cleanupOrThrow(context, ledger)
        return decision
      }
      validated = { tipSha: validation.tipSha, changedPaths: validation.changedPaths }
      await updateRunLedger(ledgerPath, {
        finalizePhase: "validated",
        validatedTipSha: validated.tipSha,
        validatedChangedPaths: validated.changedPaths,
      })
    } else if (validation.status === "no_changes") {
      const decision = { outcome: "no_changes" as const }
      await updateRunLedger(ledgerPath, {
        finalizePhase: "validated",
        validatedTipSha: validation.tipSha,
        validatedChangedPaths: [],
        finalizeOutcome: decision.outcome,
      })
      await cleanupOrThrow(context, ledger)
      return decision
    } else {
      const decision = {
        outcome: validation.status as Extract<ReflectionOutcome, "dirty_uncommitted" | "failed">,
        reason: "completion_validation",
        detail: validation.detail,
      }
      await checkpointDecision(ledgerPath, decision)
      await cleanupOrThrow(context, ledger)
      return decision
    }
    ledger = parseReservationRunLedger(await readRunJson<unknown>(ledgerPath))
  }

  if (validated === undefined) {
    if (ledger.mergePolicy === "auto") {
      const legacy = await probeLegacyAutoRunReceipt(worktree, ledger.runId)
      if (legacy.status === "integrated") {
        const budget = await validateIntegratedDreamBudget(context, ledger)
        const decision = { outcome: "merged" as const, integrationSha: legacy.integrationSha, ...budget }
        await checkpointIntegrated(ledgerPath, decision)
        await cleanupOrThrow(context, ledger)
        return decision
      }
    }
    const decision = { outcome: "failed" as const, reason: "missing_validated_tip" }
    await checkpointDecision(ledgerPath, decision)
    await cleanupOrThrow(context, ledger)
    return decision
  }

  if (validated.tipSha === ledger.baseSha) {
    const decision = { outcome: "no_changes" as const }
    await checkpointDecision(ledgerPath, decision)
    await cleanupOrThrow(context, ledger)
    return decision
  }
  const mode = ledger.mergePolicy === "auto" ? "auto" : "integration"
  const probe = await probeReflectionIntegration(worktree, {
    mode,
    runId: ledger.runId,
    validatedTipSha: validated.tipSha,
  })
  if (probe.status === "integrated") {
    const budget = await validateIntegratedDreamBudget(context, ledger)
    const decision = { outcome: "merged" as const, integrationSha: probe.integrationSha, ...budget }
    await checkpointIntegrated(ledgerPath, decision)
    await cleanupOrThrow(context, ledger)
    return decision
  }
  if (!existsSync(worktree.dir)) {
    const decision = { outcome: "failed" as const, reason: "missing_worktree" }
    await checkpointDecision(ledgerPath, decision)
    return decision
  }
  const integrated = await integrateValidatedReflection(worktree, {
    mode,
    runId: ledger.runId,
    summary: `${ledger.trigger} ${ledger.runId}`,
    validated,
    withWriterLock: (operation) => writerLock(context, operation),
  })
  const budget = integrated.outcome === "merged"
    ? await validateIntegratedDreamBudget(context, ledger)
    : {}
  const decision: DurableFinalizationDecision = {
    outcome: integrated.outcome,
    ...(integrated.detail === undefined ? {} : { detail: integrated.detail }),
    ...(integrated.integrationSha === undefined ? {} : { integrationSha: integrated.integrationSha }),
    ...budget,
  }
  if (decision.outcome === "merged") await checkpointIntegrated(ledgerPath, decision)
  else await checkpointDecision(ledgerPath, decision)
  await cleanupOrThrow(context, ledger)
  return decision
}

function validatedFromLedger(ledger: ReservationRunLedger): ValidatedReflectionTip | undefined {
  return ledger.validatedTipSha === undefined
    ? undefined
    : { tipSha: ledger.validatedTipSha, changedPaths: ledger.validatedChangedPaths ?? [] }
}

function decisionFromLedger(
  ledger: ReservationRunLedger,
): DurableFinalizationDecision | undefined {
  if (ledger.finalizeOutcome === undefined) return undefined
  return {
    outcome: ledger.finalizeOutcome,
    ...(ledger.finalizeReason === undefined ? {} : { reason: ledger.finalizeReason }),
    ...(ledger.finalizeDetail === undefined ? {} : { detail: ledger.finalizeDetail }),
    ...(ledger.integrationSha === undefined ? {} : { integrationSha: ledger.integrationSha }),
  }
}

async function checkpointDecision(path: string, decision: DurableFinalizationDecision): Promise<void> {
  await updateRunLedger(path, {
    finalizeOutcome: decision.outcome,
    ...(decision.reason === undefined ? {} : { finalizeReason: decision.reason }),
    ...(decision.detail === undefined ? {} : { finalizeDetail: decision.detail }),
  })
}

async function checkpointIntegrated(path: string, decision: DurableFinalizationDecision): Promise<void> {
  await updateRunLedger(path, {
    finalizePhase: "integrated",
    finalizeOutcome: decision.outcome,
    ...(decision.reason === undefined ? {} : { finalizeReason: decision.reason }),
    ...(decision.detail === undefined ? {} : { finalizeDetail: decision.detail }),
    integrationSha: decision.integrationSha,
  })
}

async function validateIntegratedDreamBudget(
  context: RunFinalizationContext,
  ledger: ReservationRunLedger,
): Promise<Pick<DurableFinalizationDecision, "reason" | "detail">> {
  if (ledger.kind !== "dream" || ledger.origin === undefined || ledger.systemTokenTarget === undefined) return {}
  const estimate = await estimateSystemTokens(context.identity.paths.repo)
  const validation = validateDreamTokenBudget({
    origin: ledger.origin,
    totalTokens: estimate.totalTokens,
    targetTokens: ledger.systemTokenTarget,
  })
  if (validation.status === "budget_not_met") {
    return { reason: "budget_not_met", detail: validation.detail }
  }
  return {
    detail: `Committed system/ estimate is ${validation.totalTokens} tokens; dream target is below ${validation.targetTokens} tokens`,
  }
}

async function cleanupOrThrow(
  context: RunFinalizationContext,
  ledger: ReservationRunLedger,
): Promise<void> {
  const cleanup = await cleanupReflectionWorktree(worktreeFromLedger(context.identity, ledger))
  if (!cleanup.worktreeRemoved || !cleanup.branchRemoved) {
    throw new Error(`Reflection cleanup incomplete for ${ledger.runId}`)
  }
}

async function writerLock<T>(context: RunFinalizationContext, operation: () => Promise<T>): Promise<T> {
  if (context.withWriterLock !== undefined) return await context.withWriterLock(operation)
  const record = await createLockRecord("memory-write")
  return await withLock(memoryWriterLockPath(context.identity.paths.locks), record, operation, {
    waitTimeoutMs: 5_000,
  })
}
