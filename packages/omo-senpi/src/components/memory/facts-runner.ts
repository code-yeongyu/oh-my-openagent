import { randomUUID } from "node:crypto"
import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { basename, join } from "node:path"
import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"

import {
  FactsFailureStore,
  FactsQueue,
  GitMemoryRepo,
  buildDefaultSeedFiles,
  selectCappedFactsBatch,
  selectLaunchable,
  type FactsFailureReason,
  type FactsPayload,
  type FactsQueueEntry,
} from "@oh-my-opencode/memory-core"
import { hasFailureReader, readLaunchableFailures, type FactsFailureReadPort } from "./facts-launch-selection"
import { queueEntryTargets, type FactsFailurePort } from "./facts-failure-recording"
import { drainFactsLaunches } from "./facts-drain"
import { classifyOversizePayload } from "./facts-oversize"
import { admitOversizedFacts } from "./facts-oversized-budget"
import { FactsTerminalWrites } from "./facts-terminal-writes"
import { readFactsPeoplePayload } from "./facts-people-payload"
import { launchFactsInProcess } from "./facts-in-process-launch"
import { resolveFactsModel } from "./facts-model"
import { readRunJson } from "./worker/run-artifacts"

export type { FactsExtractorRunnerOptions, FactsLaunchResult } from "./facts-runner-types"
import type { FactsExtractorRunnerOptions, FactsLaunchResult, FactsModelSelection, FactsRunLedger } from "./facts-runner-types"
import { describe, FACTS_DEADLINE_MS, queueKeys, reserveFactsRunDir } from "./facts-run-storage"
import { createFactsRunMaintenance } from "./facts-run-maintenance"

export class FactsExtractorRunner {
  private readonly queue: FactsQueue
  private readonly now: () => Date
  private readonly terminal: FactsTerminalWrites
  private readonly failureReader: FactsFailureReadPort
  private readonly maintenance: ReturnType<typeof createFactsRunMaintenance>
  private activeLaunch: Promise<FactsLaunchResult> | undefined; private activeCancel: (() => void) | undefined
  private readonly activeReconciles = new Map<Promise<FactsLaunchResult>, AbortController>()

  constructor(private readonly options: FactsExtractorRunnerOptions) {
    this.queue = options.queue ?? new FactsQueue({ identityPaths: options.identity.paths })
    this.now = options.now ?? (() => new Date())
    const store = new FactsFailureStore({ identityPaths: options.identity.paths, now: this.now })
    const failures: FactsFailurePort = options.failures ?? store
    // A recording double that cannot read falls back to the durable store: gating must never
    // be answered by a seam that does not know the real ledger.
    this.failureReader = hasFailureReader(failures) ? failures : store
    this.terminal = new FactsTerminalWrites({
      failures,
      now: this.now,
      markConsumed: (entries) => this.queue.markConsumed(entries),
      receiptsDir: options.identity.paths.runtime,
      ...(options.writeTerminalSentinel === undefined ? {} : { write: options.writeTerminalSentinel }),
      ...(options.removeRunArtifact === undefined ? {} : { remove: options.removeRunArtifact }),
      ...(options.logger === undefined ? {} : { warn: (message, fields) => options.logger?.warn(message, fields) }),
    })
    this.maintenance = createFactsRunMaintenance(options, this.terminal, this.now)
  }

  async launchPending(signal?: AbortSignal, selection?: FactsModelSelection): Promise<FactsLaunchResult> {
    if (signal?.aborted === true) return { status: "skipped" }
    if (this.activeLaunch !== undefined) return { status: "active" }
    const captured = selection ?? {
      registry: this.options.resolveModelRegistry(), sessionModel: this.options.resolveSessionModel?.(),
    }
    const operation = drainFactsLaunches(() => this.launchPendingOnce(captured, signal), signal)
    this.activeLaunch = operation
    try {
      return await operation
    } finally {
      if (this.activeLaunch === operation) { this.activeLaunch = undefined; this.activeCancel = undefined }
    }
  }

  /**
   * Stops the in-flight child AND every reconcile still in flight, then waits for them. A
   * reconcile is detached at bind (`fire("reconcile")`), so without this a shutdown could release
   * the identity while the reconcile's remaining steps still write into its runtime tree - for a
   * transient run (#7765) that recreates the directories finalize has just removed.
   */
  async cancelActive(): Promise<void> {
    for (const abort of this.activeReconciles.values()) abort.abort()
    this.activeCancel?.()
    await Promise.allSettled([...this.activeReconciles.keys(), this.activeLaunch])
  }

  async reconcilePending(signal?: AbortSignal): Promise<FactsLaunchResult> {
    const abort = new AbortController()
    const operation = this.reconcilePendingOnce(signal === undefined ? abort.signal : AbortSignal.any([signal, abort.signal]))
    this.activeReconciles.set(operation, abort)
    try {
      return await operation
    } finally {
      this.activeReconciles.delete(operation)
    }
  }

  private async reconcilePendingOnce(signal: AbortSignal): Promise<FactsLaunchResult> {
    const active = await this.maintenance.reconcile()
    if (active) return { status: "active" }
    if (signal.aborted) return { status: "skipped" }
    return { status: "empty" }
  }

  private async launchPendingOnce(modelSelection: FactsModelSelection, signal?: AbortSignal): Promise<FactsLaunchResult> {
    const isAborted = (): boolean => signal?.aborted === true
    if (isAborted()) return { status: "skipped" }
    if (await this.maintenance.reconcile()) return { status: "active" }
    const pending = await this.queue.listPending()
    if (isAborted()) return { status: "skipped" }
    if (pending.length === 0) return { status: "empty" }
    const ledger = await readLaunchableFailures(this.failureReader, (message, fields) =>
      this.options.logger?.warn(message, fields),
    )
    if (!ledger.ok || isAborted()) return { status: "skipped" }
    const selection = selectLaunchable(pending, ledger.failures, this.now())
    if (selection.selected.length === 0) return { status: "empty" }
    const claimId = randomUUID()
    const entries = await this.queue.claim(selection.selected, claimId)
    if (entries.length === 0) return { status: "active" }
    const releaseClaim = async (): Promise<void> => this.queue.releaseClaim(entries, claimId)
    const loaded = this.options.loadConfig(); const deadlineMs = this.options.deadlineMs ?? FACTS_DEADLINE_MS
    const modelRegistry = modelSelection.registry; const resolution = resolveFactsModel(
      loaded.config, modelRegistry, modelSelection.sessionModel, this.options.identity.id,
    )
    const childModelRegistry = isChildModelRegistry(modelRegistry) ? modelRegistry : undefined
    if (childModelRegistry === undefined || resolution.kind === "category_unavailable" || resolution.source !== undefined) {
      const cause = resolution.kind === "category_unavailable" ? resolution.cause : resolution.source
      this.options.logger?.warn("facts extraction skipped: no usable user-selected model", { cause })
      await releaseClaim()
      return { status: "skipped" }
    }

    let repo: GitMemoryRepo
    try {
      repo = new GitMemoryRepo({ dir: this.options.identity.paths.repo, agentId: this.options.identity.id })
      if (!existsSync(join(repo.dir, ".git"))) await repo.init({ seedFiles: buildDefaultSeedFiles() })
    } catch (error) {
      await releaseClaim()
      throw error
    }
    const people = await readFactsPeoplePayload(repo.dir)
    const envelope = { version: 1, identity: this.options.identity.id, today: this.now().toISOString().slice(0, 10), ...people } as const
    const capped = selectCappedFactsBatch({ entries, envelope, now: this.now() })
    const oversizedModel = capped.oversized.length === 0 ? undefined
      : (await import("#omo-task-runtime")).findModelReference(childModelRegistry, resolution.model)
    const admitted = capped.envelopeOversized ? [] : capped.oversized.filter((entry) =>
      admitOversizedFacts({ ...envelope, entries: [entry] }, oversizedModel),
    )
    const envelopeRefused = await classifyOversizePayload({
      terminal: this.terminal,
      envelope,
      oversized: capped.oversized.filter((entry) => !admitted.includes(entry)),
      pending: entries,
      envelopeOversized: capped.envelopeOversized,
      ...(this.options.createPreflightId === undefined ? {} : { createFailureId: this.options.createPreflightId }),
      warn: (message, fields) => this.options.logger?.warn(message, fields),
    })
    if (envelopeRefused) {
      await releaseClaim()
      return { status: "skipped" }
    }
    const batch: readonly FactsQueueEntry[] = capped.selected.length > 0 ? capped.selected : admitted.slice(0, 1)
    if (batch.length === 0) {
      this.options.logger?.warn("facts batch selection carried nothing within the payload cap", {
        pending: entries.length,
        oversized: capped.oversized.length,
      })
      await releaseClaim()
      return { status: "empty" }
    }
    await this.queue.releaseClaim(entries.filter((entry) => !batch.includes(entry)), claimId)
    const batchId = (this.options.createBatchId ?? randomUUID)()
    const launchedAt = this.now().getTime(); if (isAborted()) {
      await this.queue.releaseClaim(batch, claimId)
      return { status: "skipped" }
    }
    let runDir: string | undefined
    try {
      runDir = await reserveFactsRunDir({
        factsDir: this.options.identity.paths.facts,
        locksDir: this.options.identity.paths.locks,
        entries: batch,
        batchId,
        launchedAt,
        deadlineMs,
        terminationGraceMs: this.options.terminationGraceMs,
        receiptsDir: this.options.identity.paths.runtime,
        warn: (message, fields) => this.options.logger?.warn(message, fields),
      })
    } catch (error) {
      await this.queue.releaseClaim(batch, claimId)
      throw error
    }
    if (runDir === undefined) {
      await this.queue.releaseClaim(batch, claimId)
      return { status: "active" }
    }
    const runId = basename(runDir); const payload: FactsPayload = { ...envelope, entries: batch }
    if (isAborted()) {
      await this.queue.releaseClaim(batch, claimId)
      return { status: "skipped" }
    }
    try {
      const cancelled = await launchFactsInProcess({
        runId,
        runDir,
        payload,
        oversized: capped.selected.length === 0,
        resolution,
        modelRegistry: childModelRegistry,
        options: this.options,
        env: this.options.env ?? process.env,
        configSources: loaded.sources,
        batchId,
        queued: queueKeys(batch),
        launchedAt,
        deadlineMs,
        onState: (state) => { this.activeCancel = state.cancel }
      })
      if (cancelled) {
        return await this.abandonCancelledRun(runDir, runId)
      }
    } catch (error) {
      const reason: FactsFailureReason = "child_exit"
      try {
        await this.terminal.fail({
          runDir,
          runId,
          batchId,
          targets: queueEntryTargets(batch),
          reason,
          detail: describe(error),
        })
      } finally {
        await this.queue.releaseClaim(batch, claimId)
      }
      return { status: "failed", runId }
    } finally {
      if (isAborted()) await this.queue.releaseClaim(batch, claimId)
    }
    try {
      return await this.maintenance.finalize(runDir, repo)
    } finally {
      await this.queue.releaseClaim(batch, claimId)
    }
  }

  private async abandonCancelledRun(runDir: string, runId: string): Promise<FactsLaunchResult> {
    const ledger = await readRunJson<FactsRunLedger>(join(runDir, "ledger.json"))
    await this.terminal.abandon(runDir, ledger, "session_shutdown")
    return { status: "failed", runId }
  }

}

function isChildModelRegistry(value: unknown): value is ChildModelRegistry {
  return value !== null && typeof value === "object" && "getProviderAuth" in value
    && typeof value.getProviderAuth === "function"
}
