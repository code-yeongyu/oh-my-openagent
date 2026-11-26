import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  cleanupReflectionWorktree,
  createLockRecord,
  describeDroppedEntries,
  integrateValidatedReflection,
  maybeKillAt,
  memoryWriterLockPath,
  pathsOutsideTarget,
  probeLegacyAutoRunReceipt,
  probeReflectionIntegration,
  preflightReflectionDescriptions,
  readDroppedTrailers,
  validateCompletion,
  validateDreamTokenBudget,
  withLock,
  type ReflectionOutcome,
  type ValidatedReflectionTip,
} from "@oh-my-opencode/memory-core"

import { estimateSystemTokens } from "../commands/tokens"
import { readRunJson, readRunTextTail, updateRunLedger, type RunOutcome } from "./run-artifacts"
import type { DurableFinalizationDecision, RunFinalizationContext } from "./run-finalization-types"
import { parseReservationRunLedger, worktreeFromLedger, type ReservationRunLedger } from "./reservation-run-ledger"

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
    await cleanupAndRecord(context, ledger, runDir)
    return decision
  }
  const checkpointed = decisionFromLedger(ledger)
  if (checkpointed !== undefined) {
    await cleanupAndRecord(context, ledger, runDir)
    return checkpointed
  }

  const worktree = worktreeFromLedger(context.identity, ledger)
  let validated = validatedFromLedger(ledger)
  if (validated === undefined && existsSync(worktree.dir)) {
    await preflightReflectionDescriptions(worktree, ledger.baseSha, worktree.exec, context.warn)
    const validation = await validateCompletion(worktree, ledger.baseSha, worktree.exec)
    if (validation.status === "valid") {
      maybeKillAt("after-validate")
      if (ledger.targetDoc !== undefined && pathsOutsideTarget(validation, [ledger.targetDoc]).length > 0) {
        const decision = {
          outcome: "failed" as const,
          reason: "invalid_target",
          detail: "Dream changed paths outside targetDoc",
        }
        await checkpointDecision(ledgerPath, decision)
        await cleanupAndRecord(context, ledger, runDir)
        return decision
      }
      validated = { tipSha: validation.tipSha, changedPaths: validation.changedPaths }
      await updateRunLedger(ledgerPath, {
        finalizePhase: "validated",
        validatedTipSha: validated.tipSha,
        validatedChangedPaths: validated.changedPaths,
      })
    } else if (validation.status === "no_changes") {
      // Every entry the run wrote was refused: say so instead of reading as "nothing to do".
      const note = validation.dropped?.length ? describeDroppedEntries(validation.dropped) : undefined
      const budget = await validateSystemBudget(context, ledger, worktree, [])
      const detail = [note, budget.detail].filter(Boolean).join("; ") || undefined
      const decision = {
        outcome: "no_changes" as const,
        ...(budget.reason === undefined ? {} : { reason: budget.reason }),
        ...(detail === undefined ? {} : { detail }),
      }
      await updateRunLedger(ledgerPath, {
        finalizePhase: "validated",
        validatedTipSha: validation.tipSha,
        validatedChangedPaths: [],
        finalizeOutcome: decision.outcome,
        ...(budget.reason === undefined ? {} : { finalizeReason: budget.reason }),
        ...(detail === undefined ? {} : { finalizeDetail: detail }),
      })
      await cleanupAndRecord(context, ledger, runDir)
      return decision
    } else {
      const decision = {
        outcome: validation.status as Extract<ReflectionOutcome, "dirty_uncommitted" | "failed">,
        reason: "completion_validation",
        detail: validation.detail,
      }
      await checkpointDecision(ledgerPath, decision)
      await cleanupAndRecord(context, ledger, runDir)
      return decision
    }
    ledger = parseReservationRunLedger(await readRunJson<unknown>(ledgerPath))
  }

  if (validated === undefined) {
    if (ledger.mergePolicy === "auto") {
      const legacy = await probeLegacyAutoRunReceipt(worktree, ledger.runId)
      if (legacy.status === "integrated") {
        const budget = await validateSystemBudget(context, ledger, worktree, undefined)
        const decision = { outcome: "merged" as const, integrationSha: legacy.integrationSha, ...budget }
        await checkpointIntegrated(ledgerPath, decision)
        await cleanupAndRecord(context, ledger, runDir)
        return decision
      }
    }
    const decision = { outcome: "failed" as const, reason: "missing_validated_tip" }
    await checkpointDecision(ledgerPath, decision)
    await cleanupAndRecord(context, ledger, runDir)
    return decision
  }

  if (validated.tipSha === ledger.baseSha) {
    const decision = { outcome: "no_changes" as const, ...(await validateSystemBudget(context, ledger, worktree, [])) }
    await checkpointDecision(ledgerPath, decision)
    await cleanupAndRecord(context, ledger, runDir)
    return decision
  }
  const mode = ledger.mergePolicy === "auto" ? "auto" : "integration"
  const probe = await probeReflectionIntegration(worktree, {
    mode,
    runId: ledger.runId,
    validatedTipSha: validated.tipSha,
  })
  if (probe.status === "integrated") {
    const budget = await validateSystemBudget(context, ledger, worktree, validated.changedPaths)
    const decision = { outcome: "merged" as const, integrationSha: probe.integrationSha, ...budget }
    await checkpointIntegrated(ledgerPath, decision)
    await cleanupAndRecord(context, ledger, runDir)
    return decision
  }
  if (!existsSync(worktree.dir)) {
    const decision = { outcome: "failed" as const, reason: "missing_worktree" }
    await checkpointDecision(ledgerPath, decision)
    return decision
  }
  // Read from the validated commit's trailers, so a run resumed after the validated checkpoint still reports them.
  const dropped = await readDroppedTrailers(worktree.exec, worktree.dir, ledger.baseSha, validated.tipSha)
  const droppedNote = dropped.length > 0 ? describeDroppedEntries(dropped) : undefined
  const integrated = await integrateValidatedReflection(worktree, {
    mode,
    runId: ledger.runId,
    summary: `${ledger.trigger} ${ledger.runId}`,
    validated,
    withWriterLock: (operation) => writerLock(context, operation),
  })
  maybeKillAt("after-merge")
  const budget =
    integrated.outcome === "merged" ? await validateSystemBudget(context, ledger, worktree, validated.changedPaths) : {}
  const decision: DurableFinalizationDecision = {
    outcome: integrated.outcome,
    ...(integrated.detail === undefined && droppedNote === undefined
      ? {}
      : { detail: [integrated.detail, droppedNote].filter(Boolean).join("; ") }),
    ...(integrated.integrationSha === undefined ? {} : { integrationSha: integrated.integrationSha }),
    ...budget,
  }
  if (decision.outcome === "merged") await checkpointIntegrated(ledgerPath, decision)
  else await checkpointDecision(ledgerPath, decision)
  await cleanupAndRecord(context, ledger, runDir)
  return decision
}

function validatedFromLedger(ledger: ReservationRunLedger): ValidatedReflectionTip | undefined {
  return ledger.validatedTipSha === undefined
    ? undefined
    : { tipSha: ledger.validatedTipSha, changedPaths: ledger.validatedChangedPaths ?? [] }
}

function decisionFromLedger(ledger: ReservationRunLedger): DurableFinalizationDecision | undefined {
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

/**
 * The committed system/ estimate against the run's target (#15054). Every dream owns the target, merged or
 * not, except a document-maintenance dream that may only touch its target doc. A reflection is held to it
 * only when it changed system/ and grew it: one that leaves system/ alone or shrinks it is not the cause.
 */
async function validateSystemBudget(
  context: RunFinalizationContext,
  ledger: ReservationRunLedger,
  worktree: ReturnType<typeof worktreeFromLedger>,
  changedPaths: readonly string[] | undefined,
): Promise<Pick<DurableFinalizationDecision, "reason" | "detail">> {
  if (ledger.systemTokenTarget === undefined) return {}
  if (ledger.kind !== "dream") {
    if (changedPaths === undefined || !changedPaths.some(isSystemMarkdown)) return {}
    const estimate = await estimateSystemTokens(context.identity.paths.repo)
    if (estimate.totalTokens < ledger.systemTokenTarget) return {}
    const base = await systemTokensAt(worktree.exec, context.identity.paths.repo, ledger.baseSha)
    if (estimate.totalTokens <= base) return {}
    return {
      reason: "budget_not_met",
      detail: `Reflection grew committed system/ from ${base} to ${estimate.totalTokens} tokens; target is below ${ledger.systemTokenTarget} tokens`,
    }
  }
  if (ledger.origin === undefined || ledger.targetDoc !== undefined) return {}
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

function isSystemMarkdown(path: string): boolean {
  return path.startsWith("system/") && path.endsWith(".md")
}

/** The same per-file `ceil(bytes / 4)` rule as `estimateSystemTokens`, read from a commit's tree. */
async function systemTokensAt(
  exec: ReturnType<typeof worktreeFromLedger>["exec"],
  repoDir: string,
  sha: string,
): Promise<number> {
  const listed = await exec.run(["ls-tree", "-r", "-l", sha, "--", "system"], { cwd: repoDir, timeoutMs: 30_000 })
  if (listed.code !== 0) throw new Error(`git ls-tree ${sha} failed: ${listed.stderr.trim()}`)
  let tokens = 0
  for (const line of listed.stdout.split("\n")) {
    const match = /^\d+ blob [0-9a-f]+ +(\d+)\t(.+)$/.exec(line)
    if (match?.[1] !== undefined && match[2]?.endsWith(".md") === true) tokens += Math.ceil(Number(match[1]) / 4)
  }
  return tokens
}

/**
 * Cleanup is bookkeeping that runs after the decision is durable. A leftover worktree or branch
 * used to throw here, which left an already-merged run unsettled until a later reconciliation and
 * re-reflected the same content. The run now settles on its real outcome, the ledger records the
 * leftover, and the reflection orphan sweep reclaims it.
 */
export async function cleanupAndRecord(
  context: RunFinalizationContext,
  ledger: ReservationRunLedger,
  runDir: string,
): Promise<void> {
  const cleanup = await cleanupReflectionWorktree(worktreeFromLedger(context.identity, ledger))
  if (cleanup.worktreeRemoved && cleanup.branchRemoved) return
  await updateRunLedger(join(runDir, "ledger.json"), { cleanupIncomplete: true })
}

async function writerLock<T>(context: RunFinalizationContext, operation: () => Promise<T>): Promise<T> {
  if (context.withWriterLock !== undefined) return await context.withWriterLock(operation)
  const record = await createLockRecord("memory-write")
  return await withLock(memoryWriterLockPath(context.identity.paths.locks), record, operation, {
    waitTimeoutMs: 5_000,
  })
}
