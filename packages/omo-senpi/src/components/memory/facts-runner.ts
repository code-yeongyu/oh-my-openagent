import { randomUUID } from "node:crypto"
import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { basename, join } from "node:path"
import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"

import {
  FactsFailureStore,
  FactsQueue,
  GitMemoryRepo,
  buildDefaultSeedFiles,
  createLockRecord,
  memoryWriterLockPath,
  runFinalizationLockPath,
  selectCappedFactsBatch,
  selectLaunchable,
  withLock,
  type FactsFailureReason,
  type FactsPayload,
  type FactsQueueEntry,
} from "@oh-my-opencode/memory-core"
import { hasFailureReader, readLaunchableFailures, type FactsFailureReadPort } from "./facts-launch-selection"
import { ledgerTargets, preflightFailureId, queueEntryTargets, type FactsFailurePort } from "./facts-failure-recording"
import { drainFactsLaunches } from "./facts-drain"
import { classifyOversizePayload } from "./facts-oversize"
import { FactsTerminalWrites } from "./facts-terminal-writes"
import { readFactsPeoplePayload } from "./facts-people-payload"
import { launchFactsInProcess } from "./facts-in-process-launch"
import { resolveReflectionModel } from "./worker/resolve-model"
import { readRunJson } from "./worker/run-artifacts"

const WRITER_WAIT_MS = 2_000

export type { FactsExtractorRunnerOptions, FactsLaunchResult } from "./facts-runner-types"
import type { FactsExtractorRunnerOptions, FactsFinalRecord, FactsLaunchResult, FactsRunLedger } from "./facts-runner-types"
import { describe, FACTS_DEADLINE_MS, finalResult, queueKeys, reserveFactsRunDir } from "./facts-run-storage"
import { finalizeClaimedFactsRun } from "./facts-run-finalize"
import { reconcileFactsRuns } from "./facts-run-reconcile"
import { sweepTerminalFactsRuns } from "./facts-run-cleanup"
import { pruneTerminalFactsRuns } from "./facts-run-prune"

export class FactsExtractorRunner {
  private readonly queue: FactsQueue
  private readonly now: () => Date
  private readonly terminal: FactsTerminalWrites
  private readonly failureReader: FactsFailureReadPort
  private activeLaunch: Promise<FactsLaunchResult> | undefined; private activeCancel: (() => void) | undefined

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
      ...(options.writeTerminalSentinel === undefined ? {} : { write: options.writeTerminalSentinel }),
      ...(options.removeRunArtifact === undefined ? {} : { remove: options.removeRunArtifact }),
      ...(options.logger === undefined ? {} : { warn: (message, fields) => options.logger?.warn(message, fields) }),
    })
  }

  async launchPending(signal?: AbortSignal): Promise<FactsLaunchResult> {
    if (signal?.aborted === true) return { status: "skipped" }
    if (this.activeLaunch !== undefined) return { status: "active" }
    const operation = drainFactsLaunches(() => this.launchPendingOnce(signal), signal)
    this.activeLaunch = operation
    try {
      return await operation
    } finally {
      if (this.activeLaunch === operation) { this.activeLaunch = undefined; this.activeCancel = undefined }
    }
  }

  async cancelActive(): Promise<void> { this.activeCancel?.(); await this.activeLaunch }

  async reconcilePending(signal?: AbortSignal): Promise<FactsLaunchResult> {
    const active = await this.reconcileRuns()
    if (active) return { status: "active" }
    return this.launchPending(signal)
  }

  private async launchPendingOnce(signal?: AbortSignal): Promise<FactsLaunchResult> {
    const isAborted = (): boolean => signal?.aborted === true
    if (isAborted()) return { status: "skipped" }
    if (await this.reconcileRuns()) return { status: "active" }
    const pending = await this.queue.listPending()
    if (isAborted()) return { status: "skipped" }
    if (pending.length === 0) return { status: "empty" }
    const ledger = await readLaunchableFailures(this.failureReader, (message, fields) =>
      this.options.logger?.warn(message, fields),
    )
    if (!ledger.ok) return { status: "skipped" }
    const selection = selectLaunchable(pending, ledger.failures, this.now())
    if (selection.selected.length === 0) return { status: "empty" }
    const claimId = randomUUID()
    const entries = await this.queue.claim(selection.selected, claimId)
    if (entries.length === 0) return { status: "active" }
    const releaseClaim = async (): Promise<void> => this.queue.releaseClaim(entries, claimId)
    const loaded = this.options.loadConfig(); const deadlineMs = this.options.deadlineMs ?? FACTS_DEADLINE_MS
    const modelRegistry = this.options.resolveModelRegistry(); const resolution = resolveReflectionModel("quick", loaded.config, modelRegistry)
    const childModelRegistry = isChildModelRegistry(modelRegistry) ? modelRegistry : undefined
    if (childModelRegistry === undefined || resolution.kind === "category_unavailable" || resolution.source !== undefined) {
      const cause = resolution.kind === "category_unavailable" ? resolution.cause : resolution.source
      this.options.logger?.warn("facts extractor quick category unavailable", { cause })
      await this.terminal.preflightFail(
        queueEntryTargets(entries),
        preflightFailureId(this.options.createPreflightId),
        "quick_category_unavailable",
        cause ?? "unknown",
      )
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
    const envelopeRefused = await classifyOversizePayload({
      terminal: this.terminal,
      envelope,
      oversized: capped.oversized,
      pending: entries,
      envelopeOversized: capped.envelopeOversized,
      ...(this.options.createPreflightId === undefined ? {} : { createFailureId: this.options.createPreflightId }),
      warn: (message, fields) => this.options.logger?.warn(message, fields),
    })
    if (envelopeRefused) {
      await releaseClaim()
      return { status: "skipped" }
    }
    if (capped.selected.length === 0) {
      this.options.logger?.warn("facts batch selection carried nothing within the payload cap", {
        pending: entries.length,
        oversized: capped.oversized.length,
      })
      await releaseClaim()
      return { status: "empty" }
    }
    const batch: readonly FactsQueueEntry[] = capped.selected
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
      return await this.finalizeRun(runDir, repo)
    } finally {
      await this.queue.releaseClaim(batch, claimId)
    }
  }

  private async reconcileRuns(): Promise<boolean> {
    // Maintenance first: terminal dirs that crashed between their sentinel and their cleanup
    // still hold a payload, and reconciliation itself never revisits a terminal dir.
    await sweepTerminalFactsRuns({
      factsDir: this.options.identity.paths.facts,
      ...(this.options.removeRunArtifact === undefined ? {} : { remove: this.options.removeRunArtifact }),
      ...(this.options.logger === undefined ? {} : { warn: (message, fields) => this.options.logger?.warn(message, fields) }),
    })
    const active = await reconcileFactsRuns({
      factsDir: this.options.identity.paths.facts,
      now: this.now,
      finalize: async (runDir) => {
        const repo = new GitMemoryRepo({ dir: this.options.identity.paths.repo, agentId: this.options.identity.id })
        await this.finalizeRun(runDir, repo)
      },
      fail: (runDir, ledger, detail) => this.terminal.fail({
        runDir,
        runId: ledger.runId,
        batchId: ledger.batchId,
        targets: ledgerTargets(ledger.queued),
        reason: "child_exit",
        detail,
      }),
      abandon: (runDir, ledger, reason) => this.terminal.abandon(runDir, ledger, reason),
      warn: (message, fields) => this.options.logger?.warn(message, fields),
    })
    await this.prune()
    return active
  }

  private async prune(): Promise<void> {
    try {
      await pruneTerminalFactsRuns({
        factsDir: this.options.identity.paths.facts,
        locksDir: this.options.identity.paths.locks,
        warn: (message, fields) => this.options.logger?.warn(message, fields),
      })
    } catch (error) {
      this.options.logger?.warn("facts run retention pruning failed", { error: describe(error) })
    }
  }

  private async abandonCancelledRun(runDir: string, runId: string): Promise<FactsLaunchResult> {
    const ledger = await readRunJson<FactsRunLedger>(join(runDir, "ledger.json"))
    await this.terminal.abandon(runDir, ledger, "session_shutdown")
    return { status: "failed", runId }
  }

  private async finalizeRun(runDir: string, repo: GitMemoryRepo): Promise<FactsLaunchResult> {
    const ledger = await readRunJson<FactsRunLedger>(join(runDir, "ledger.json"))
    const record = await createLockRecord("facts-finalize", { runId: ledger.runId })
    const finalizeLock = runFinalizationLockPath(this.options.identity.paths.locks, ledger.runId)
    const result = await withLock<FactsLaunchResult>(finalizeLock, record, async () => {
      const finalPath = join(runDir, "final.json")
      if (existsSync(finalPath)) return finalResult(await readRunJson<FactsFinalRecord>(finalPath))
      if (existsSync(join(runDir, "abandoned.json"))) return { status: "failed", runId: ledger.runId }
      return finalizeClaimedFactsRun({
        runDir,
        repo,
        ledger,
        identity: this.options.identity,
        terminal: this.terminal,
        options: this.options,
        ...(this.options.logger === undefined ? {} : { logger: this.options.logger }),
        withWriterLock: (operation, attempt) => this.withWriterLock(operation, attempt),
      })
    }, { waitTimeoutMs: WRITER_WAIT_MS })
    await this.prune()
    return result
  }

  private async withWriterLock<T>(operation: () => Promise<T>, attempt: number): Promise<T> {
    if (this.options.withWriterLock !== undefined) return this.options.withWriterLock(operation, attempt)
    const record = await createLockRecord("memory-write", { runId: `facts-${attempt}` })
    return withLock(memoryWriterLockPath(this.options.identity.paths.locks), record, operation, {
      waitTimeoutMs: WRITER_WAIT_MS,
    })
  }
}

function isChildModelRegistry(value: unknown): value is ChildModelRegistry {
  return value !== null && typeof value === "object" && "getProviderAuth" in value
    && typeof value.getProviderAuth === "function"
}
