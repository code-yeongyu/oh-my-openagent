import { randomUUID } from "node:crypto"
import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { basename, join } from "node:path"

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
import { SandboxUnavailableError } from "./sandbox-contracts"
import { launchFactsModelChain } from "./worker/facts-child-launch"
import { resolveReflectionModel } from "./worker/resolve-model"
import { readRunJson } from "./worker/run-artifacts"

const QUICK_CATEGORY = "quick"
const DEFAULT_DEADLINE_MS = 15 * 60_000
const WRITER_WAIT_MS = 2_000

export type { FactsExtractorRunnerOptions, FactsLaunchResult } from "./facts-runner-types"
import type { FactsExtractorRunnerOptions, FactsFinalRecord, FactsLaunchResult, FactsRunLedger } from "./facts-runner-types"
import { describe, finalResult, queueKeys, reserveFactsRunDir } from "./facts-run-storage"
import { finalizeClaimedFactsRun } from "./facts-run-finalize"
import { reconcileFactsRuns } from "./facts-run-reconcile"
import { sweepTerminalFactsRuns } from "./facts-run-cleanup"
import { pruneTerminalFactsRuns } from "./facts-run-prune"

export class FactsExtractorRunner {
  private readonly queue: FactsQueue
  private readonly now: () => Date
  private readonly terminal: FactsTerminalWrites
  private readonly failureReader: FactsFailureReadPort
  private activeLaunch: Promise<FactsLaunchResult> | undefined

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

  /**
   * Launches pending facts work and DRAINS: a capped payload splits one backlog into several
   * runs, so every success immediately attempts the next batch instead of waiting for another
   * settle. The existing `activeLaunch` latch spans the whole drain, so a concurrent caller is
   * still refused with `active` and only one launch ever runs.
   */
  async launchPending(signal?: AbortSignal): Promise<FactsLaunchResult> {
    if (signal?.aborted === true) return { status: "skipped" }
    if (this.activeLaunch !== undefined) return { status: "active" }
    const operation = drainFactsLaunches(() => this.launchPendingOnce(signal), signal)
    this.activeLaunch = operation
    try {
      return await operation
    } finally {
      if (this.activeLaunch === operation) this.activeLaunch = undefined
    }
  }

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
    // FAIL-CLOSED: an unreadable ledger aborts the launch. Treating it as "no failures" would
    // relaunch every parked batch forever - the incident this gating exists to prevent.
    const ledger = await readLaunchableFailures(this.failureReader, (message, fields) =>
      this.options.logger?.warn(message, fields),
    )
    if (!ledger.ok) return { status: "skipped" }
    const selection = selectLaunchable(pending, ledger.failures, this.now())
    if (selection.selected.length === 0) return { status: "empty" }
    const entries: readonly FactsQueueEntry[] = selection.selected
    const loaded = this.options.loadConfig()
    const resolution = resolveReflectionModel(QUICK_CATEGORY, loaded.config, this.options.resolveModelRegistry())
    // `category_unavailable` is not the only unavailable answer. resolveReflectionModel also has a
    // beyond-category ladder (registry_fallback / session_inherit) that resolves ANY usable registry
    // model when the quick chain is dead, and it marks those resolutions with a `source`.
    // Category-sourced resolutions carry no `source`. This surface is quick-PINNED with no fallback:
    // an unattended extraction must never land on an arbitrary, possibly frontier-priced model, so
    // anything outside the category counts as unavailable and takes the same skip path.
    if (resolution.kind === "category_unavailable" || resolution.source !== undefined) {
      const cause = resolution.kind === "category_unavailable" ? resolution.cause : resolution.source
      this.options.logger?.warn("facts extractor quick category unavailable", { cause })
      await this.terminal.preflightFail(
        queueEntryTargets(entries),
        preflightFailureId(this.options.createPreflightId),
        "quick_category_unavailable",
        cause ?? "unknown",
      )
      return { status: "skipped" }
    }

    const repo = new GitMemoryRepo({ dir: this.options.identity.paths.repo, agentId: this.options.identity.id })
    if (!existsSync(join(repo.dir, ".git"))) await repo.init({ seedFiles: buildDefaultSeedFiles() })
    // The people fields are part of the measured envelope, so they are read BEFORE the cap
    // decides which entries fit - and the run dir is reserved for the SELECTED entries only.
    const people = await readFactsPeoplePayload(repo.dir)
    const envelope = {
      version: 1,
      identity: this.options.identity.id,
      today: this.now().toISOString().slice(0, 10),
      ...people,
    } as const
    const capped = selectCappedFactsBatch({ entries, envelope, now: this.now() })
    // Ledger-only classification, BEFORE any reservation: an entry that cannot ever fit parks
    // now, so a failing launch path can never lose the verdict.
    const envelopeRefused = await classifyOversizePayload({
      terminal: this.terminal,
      envelope,
      oversized: capped.oversized,
      pending: entries,
      envelopeOversized: capped.envelopeOversized,
      ...(this.options.createPreflightId === undefined ? {} : { createFailureId: this.options.createPreflightId }),
      warn: (message, fields) => this.options.logger?.warn(message, fields),
    })
    if (envelopeRefused) return { status: "skipped" }
    if (capped.selected.length === 0) {
      this.options.logger?.warn("facts batch selection carried nothing within the payload cap", {
        pending: entries.length,
        oversized: capped.oversized.length,
      })
      return { status: "empty" }
    }
    const batch: readonly FactsQueueEntry[] = capped.selected
    const batchId = (this.options.createBatchId ?? randomUUID)()
    const launchedAt = this.now().getTime()
    if (isAborted()) return { status: "skipped" }
    const runDir = await reserveFactsRunDir({
      factsDir: this.options.identity.paths.facts,
      locksDir: this.options.identity.paths.locks,
      entries: batch,
      batchId,
      launchedAt,
      deadlineMs: this.options.deadlineMs,
      terminationGraceMs: this.options.terminationGraceMs,
    })
    if (runDir === undefined) return { status: "active" }
    const runId = basename(runDir)
    const payload: FactsPayload = { ...envelope, entries: batch }
    if (isAborted()) return { status: "skipped" }
    try {
      const { child } = await launchFactsModelChain({
        runId,
        runDir,
        payload,
        resolution,
        env: this.options.env ?? process.env,
        configSources: loaded.sources,
        warn: (message, details) => this.options.logger?.warn(message, details),
        senpiCommand: this.options.senpiCommand,
        senpiPrefixArgs: this.options.senpiPrefixArgs,
        resolveAndPreflightLaunch: this.options.resolveAndPreflightLaunch,
        hardDeadlineAt: Date.now() + (this.options.deadlineMs ?? DEFAULT_DEADLINE_MS),
        terminationGraceMs: this.options.terminationGraceMs,
        maxOutputBytes: this.options.maxOutputBytes,
        sandbox: this.options.sandbox,
        supervisorPath: this.options.supervisorPath,
        batchId,
        queued: queueKeys(batch),
        launchedAt,
      })
      if (child.timedOut || child.code !== 0) {
        const reason: FactsFailureReason = child.timedOut ? "deadline_exceeded" : "child_exit"
        const detail = child.stderr.trim() || "facts child failed"
        await this.terminal.fail({ runDir, runId, batchId, targets: queueEntryTargets(batch), reason, detail })
        return { status: "failed", runId }
      }
    } catch (error) {
      const reason: FactsFailureReason = error instanceof SandboxUnavailableError ? "sandbox_unavailable" : "child_exit"
      await this.terminal.fail({
        runDir,
        runId,
        batchId,
        targets: queueEntryTargets(batch),
        reason,
        detail: describe(error),
      })
      return { status: "failed", runId }
    }
    return this.finalizeRun(runDir, repo)
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

  /**
   * Retention pruning. Always OUTSIDE the finalize lock (the prune path takes each run's finalize
   * lock itself, non-blocking) and never allowed to fail a run: retention is best effort, the
   * outcome it follows is already published.
   */
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

  private async finalizeRun(runDir: string, repo: GitMemoryRepo): Promise<FactsLaunchResult> {
    const ledger = await readRunJson<FactsRunLedger>(join(runDir, "ledger.json"))
    const record = await createLockRecord("facts-finalize", { runId: ledger.runId })
    // The prune below runs only after this lock is released: it takes each run's finalize lock
    // itself, and a run holding its own finalize lock could never be pruned from inside it.
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
