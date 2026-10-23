// Finalize state machine for a claimed facts run: decide the terminal outcome from the run's
// own artifacts (batch receipt, supervisor outcome, extraction, apply result) and route it
// through the ordered terminal writes. Every failure branch names its own reason - the reason
// is the run's diagnosis, never a guess re-derived from a message string.

import { readFile } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  findFactsBatchReceipt,
  parseAgreementRecordsJsonl,
  parseFactsExtractionJsonl,
  type AgreementExtractionRecord,
  MemorySecretError,
  type FactsFailureReason,
  type FactsPayload,
  type GitMemoryRepo,
  type MemoryIdentity,
} from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"
import { applyFactsWithRetries, resolveFactsPeopleRouting } from "./facts-batch-apply"
import { FACTS_AGREEMENTS_FILENAME, resolveFactsAgreements } from "./facts-agreements"
import { ledgerTargets } from "./facts-failure-recording"
import { describe } from "./facts-run-storage"
import type { FactsExtractorRunnerOptions, FactsLaunchResult, FactsRunLedger } from "./facts-runner-types"
import type { FactsTerminalWrites } from "./facts-terminal-writes"
import { readRunJson, type RunOutcome } from "./worker/run-artifacts"

export interface FinalizeClaimedFactsRunInput {
  readonly runDir: string
  readonly repo: GitMemoryRepo
  readonly ledger: FactsRunLedger
  readonly identity: MemoryIdentity
  readonly terminal: FactsTerminalWrites
  readonly options: FactsExtractorRunnerOptions
  readonly logger?: ComponentLogger
  readonly withWriterLock: <T>(operation: () => Promise<T>, attempt: number) => Promise<T>
}

export async function finalizeClaimedFactsRun(input: FinalizeClaimedFactsRunInput): Promise<FactsLaunchResult> {
  const { runDir, repo, ledger, terminal } = input
  const runId = ledger.runId
  const receipt = await findFactsBatchReceipt(repo, ledger.batchId)
  const payload = await readRunJson<FactsPayload>(join(runDir, "facts-payload.json"))
  const batch = { entries: payload.entries, targets: ledgerTargets(ledger.queued) }
  const fail = (reason: FactsFailureReason, detail: string, outcome?: "parent_dirty"): Promise<void> =>
    terminal.fail({
      runDir,
      runId,
      batchId: ledger.batchId,
      targets: batch.targets,
      reason,
      detail,
      ...(outcome === undefined ? {} : { outcome }),
    })

  if (receipt !== undefined) {
    await terminal.succeed(runDir, runId, "committed", batch, receipt.sha)
    return { status: "committed", runId, sha: receipt.sha }
  }
  const outcome = await readRunJson<RunOutcome>(join(runDir, "outcome.json"))
  if (outcome.timedOut || outcome.childExit.code !== 0) {
    await fail(outcome.timedOut ? "deadline_exceeded" : "child_exit", "facts child did not exit successfully")
    return { status: "failed", runId }
  }

  let records: ReturnType<typeof parseFactsExtractionJsonl>
  let agreements: readonly AgreementExtractionRecord[]
  try {
    records = parseFactsExtractionJsonl(await readFile(join(runDir, "extraction.jsonl"), "utf8"))
    agreements = parseAgreementRecordsJsonl(await readOptional(join(runDir, FACTS_AGREEMENTS_FILENAME)))
  } catch (error) {
    await fail("invalid_extraction", describe(error))
    return { status: "failed", runId }
  }
  if (records.length === 0 && agreements.length === 0) {
    await terminal.succeed(runDir, runId, "no_facts", batch)
    return { status: "no_facts", runId }
  }

  let applied
  try {
    applied = await applyWithRetries(input, records, agreements)
  } catch (error) {
    if (error instanceof MemorySecretError) {
      await fail("secret_like_content", error.message)
      return { status: "failed", runId }
    }
    await fail("invalid_extraction", describe(error))
    return { status: "failed", runId }
  }
  if (applied === undefined) {
    await fail("memory_write_lock_exhausted", "memory-write lock exhausted")
    return { status: "failed", runId }
  }
  if (applied.outcome === "parent_dirty") {
    await fail("parent_dirty", applied.detail ?? "memory repository contains foreign state", "parent_dirty")
    return { status: "parent_dirty", runId }
  }
  if (applied.outcome === "unchanged") {
    await terminal.succeed(runDir, runId, "no_facts", batch)
    return { status: "no_facts", runId }
  }
  await terminal.succeed(runDir, runId, "committed", batch, applied.sha)
  return { status: "committed", runId, sha: applied.sha }
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""
    throw error
  }
}

function applyWithRetries(
  input: FinalizeClaimedFactsRunInput,
  records: ReturnType<typeof parseFactsExtractionJsonl>,
  agreements: readonly AgreementExtractionRecord[],
) {
  const config = input.options.loadConfig().config
  return applyFactsWithRetries({
    runDir: input.runDir,
    ledger: input.ledger,
    repo: input.repo,
    records,
    agreements,
    agreementsPolicy: resolveFactsAgreements(config, input.identity.id).policy,
    people: resolveFactsPeopleRouting(config, input.identity.id),
    identity: input.identity,
    logger: input.logger,
    withWriterLock: input.withWriterLock,
    retryDelay: input.options.retryDelay,
    random: input.options.random,
  })
}
