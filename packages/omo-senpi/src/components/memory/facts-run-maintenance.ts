import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"
import {
  GitMemoryRepo, createLockRecord, runFinalizationLockPath, withLock,
} from "@oh-my-opencode/memory-core"
import { loadOnboardingScanRuntime } from "../onboarding/scan-component"
import { appliedFactsDir, withFactsWriterLock } from "./facts-batch-apply"
import { ledgerTargets } from "./facts-failure-recording"
import { finalizeClaimedFactsRun } from "./facts-run-finalize"
import { reconcileFactsRuns } from "./facts-run-reconcile"
import { sweepTerminalFactsRuns } from "./facts-run-cleanup"
import { pruneTerminalFactsRuns } from "./facts-run-prune"
import { describe, finalResult } from "./facts-run-storage"
import type { FactsExtractorRunnerOptions, FactsFinalRecord, FactsLaunchResult, FactsRunLedger } from "./facts-runner-types"
import type { FactsTerminalWrites } from "./facts-terminal-writes"
import { readRunJson } from "./worker/run-artifacts"

/** Artifact recovery, terminal finalization, and retention never create a model child. */
export function createFactsRunMaintenance(
  options: FactsExtractorRunnerOptions,
  terminal: FactsTerminalWrites,
  now: () => Date,
) {
  async function withWriterLock<T>(operation: () => Promise<T>, attempt: number): Promise<T> {
    if (options.withWriterLock !== undefined) return options.withWriterLock(operation, attempt)
    return withFactsWriterLock(options.identity.paths.locks, operation, attempt)
  }

  async function prune(): Promise<void> {
    try {
      await pruneTerminalFactsRuns({
        factsDir: options.identity.paths.facts, locksDir: options.identity.paths.locks,
        warn: (message, fields) => options.logger?.warn(message, fields),
      })
    } catch (error) {
      options.logger?.warn("facts run retention pruning failed", { error: describe(error) })
    }
  }

  async function finalize(runDir: string, repo: GitMemoryRepo): Promise<FactsLaunchResult> {
    const ledger = await readRunJson<FactsRunLedger>(join(runDir, "ledger.json"))
    const record = await createLockRecord("facts-finalize", { runId: ledger.runId })
    const result = await withLock<FactsLaunchResult>(
      runFinalizationLockPath(options.identity.paths.locks, ledger.runId), record, async () => {
        const finalPath = join(runDir, "final.json")
        if (existsSync(finalPath)) return finalResult(await readRunJson<FactsFinalRecord>(finalPath))
        if (existsSync(join(runDir, "abandoned.json"))) return { status: "failed", runId: ledger.runId }
        return finalizeClaimedFactsRun({
          runDir, repo, ledger, identity: options.identity, terminal, options,
          ...(options.logger === undefined ? {} : { logger: options.logger }),
          withWriterLock,
        })
      }, { waitTimeoutMs: 2_000 },
    )
    await prune()
    return result
  }

  async function reconcile(): Promise<boolean> {
    await sweepTerminalFactsRuns({
      factsDir: options.identity.paths.facts,
      ...(options.removeRunArtifact === undefined ? {} : { remove: options.removeRunArtifact }),
      ...(options.logger === undefined ? {} : { warn: (message, fields) => options.logger?.warn(message, fields) }),
    })
    const active = await reconcileFactsRuns({
      factsDir: options.identity.paths.facts, now,
      finalize: async (runDir) => {
        const repo = new GitMemoryRepo({ dir: options.identity.paths.repo, agentId: options.identity.id })
        await finalize(runDir, repo)
      },
      fail: (runDir, ledger, detail) => terminal.fail({
        runDir, runId: ledger.runId, batchId: ledger.batchId,
        targets: ledgerTargets(ledger.queued), reason: "child_exit", detail,
      }),
      abandon: (runDir, ledger, reason) => terminal.abandon(runDir, ledger, reason),
      warn: (message, fields) => options.logger?.warn(message, fields),
      receiptsDir: options.identity.paths.runtime,
    })
    let appliedActive = false
    // Onboarding apply envelopes are rare: their reconcile ships in the onboarding-scan sidecar.
    if (existsSync(appliedFactsDir(options.identity.paths.facts))) {
      try {
        appliedActive = await (await loadOnboardingScanRuntime()).reconcileAppliedFactsBatches({
          identity: options.identity, withWriterLock,
          ...(options.logger === undefined ? {} : { logger: options.logger }),
        })
      } catch (error) {
        options.logger?.warn("facts applied batch reconcile could not run", { error: describe(error) })
      }
    }
    await prune()
    return active || appliedActive
  }

  return { reconcile, finalize }
}
