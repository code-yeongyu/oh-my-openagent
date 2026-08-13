import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { basename, join } from "node:path"

import {
  FactsQueue,
  GitMemoryRepo,
  findFactsBatchReceipt,
  buildDefaultSeedFiles,
  createLockRecord,
  memoryWriterLockPath,
  parseFactsExtractionJsonl,
  withLock,
  type FactsPayload,
  type FactsQueueEntry,
} from "@oh-my-opencode/memory-core"
import { readFactsPeoplePayload } from "./facts-people-payload"
import { launchFactsModelChain } from "./worker/facts-child-launch"
import { resolveReflectionModel } from "./worker/resolve-model"
import { readRunJson, type RunOutcome } from "./worker/run-artifacts"

const QUICK_CATEGORY = "quick"
const DEFAULT_DEADLINE_MS = 15 * 60_000
const WRITER_WAIT_MS = 2_000

export type { FactsExtractorRunnerOptions, FactsLaunchResult } from "./facts-runner-types"
import type { FactsExtractorRunnerOptions, FactsFinalRecord, FactsLaunchResult, FactsRunLedger } from "./facts-runner-types"
import { describe, finalResult, queueKeys, reserveFactsRunDir, writeFactsFinal } from "./facts-run-storage"
import { applyFactsWithRetries, resolveFactsPeopleRouting } from "./facts-batch-apply"
import { reconcileFactsRuns } from "./facts-run-reconcile"

export class FactsExtractorRunner {
  private readonly queue: FactsQueue
  private readonly now: () => Date
  private activeLaunch: Promise<FactsLaunchResult> | undefined

  constructor(private readonly options: FactsExtractorRunnerOptions) {
    this.queue = options.queue ?? new FactsQueue({ identityPaths: options.identity.paths })
    this.now = options.now ?? (() => new Date())
  }

  async launchPending(signal?: AbortSignal): Promise<FactsLaunchResult> {
    if (signal?.aborted === true) return { status: "skipped" }
    if (this.activeLaunch !== undefined) return { status: "active" }
    const operation = this.launchPendingOnce(signal)
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
    console.error("[facts-runner-trace] launch:start")
    const isAborted = (): boolean => signal?.aborted === true
    if (isAborted()) return { status: "skipped" }
    console.error("[facts-runner-trace] launch:reconcile:start")
    const hasActiveRun = await this.reconcileRuns()
    console.error(`[facts-runner-trace] launch:reconcile:done active=${hasActiveRun}`)
    if (hasActiveRun) return { status: "active" }
    console.error("[facts-runner-trace] launch:queue:start")
    const entries = await this.queue.listPending()
    console.error(`[facts-runner-trace] launch:queue:done count=${entries.length}`)
    if (isAborted()) return { status: "skipped" }
    if (entries.length === 0) return { status: "empty" }
    console.error("[facts-runner-trace] launch:config:start")
    const loaded = this.options.loadConfig()
    const resolution = resolveReflectionModel(QUICK_CATEGORY, loaded.config, this.options.resolveModelRegistry())
    console.error(`[facts-runner-trace] launch:config:done kind=${resolution.kind}`)
    if (resolution.kind === "category_unavailable") {
      this.options.logger?.warn("facts extractor quick category unavailable", { cause: resolution.cause })
      return { status: "skipped" }
    }

    const repo = new GitMemoryRepo({ dir: this.options.identity.paths.repo, agentId: this.options.identity.id })
    console.error("[facts-runner-trace] launch:repo:start")
    if (!existsSync(join(repo.dir, ".git"))) await repo.init({ seedFiles: buildDefaultSeedFiles() })
    console.error("[facts-runner-trace] launch:repo:done")
    const batchId = (this.options.createBatchId ?? randomUUID)()
    const launchedAt = this.now().getTime()
    if (isAborted()) return { status: "skipped" }
    console.error("[facts-runner-trace] launch:reserve:start")
    const runDir = await reserveFactsRunDir({
      factsDir: this.options.identity.paths.facts,
      entries,
      batchId,
      launchedAt,
      deadlineMs: this.options.deadlineMs,
      terminationGraceMs: this.options.terminationGraceMs,
    })
    console.error(`[facts-runner-trace] launch:reserve:done active=${runDir === undefined}`)
    if (runDir === undefined) return { status: "active" }
    const runId = basename(runDir)
    console.error(`[facts-runner-trace] launch:people:start runId=${runId}`)
    const people = await readFactsPeoplePayload(repo.dir)
    console.error(`[facts-runner-trace] launch:people:done runId=${runId}`)
    const payload: FactsPayload = {
      version: 1,
      identity: this.options.identity.id,
      today: this.now().toISOString().slice(0, 10),
      entries,
      ...people,
    }
    if (isAborted()) return { status: "skipped" }
    try {
      console.error(`[facts-runner-trace] launch:child:start runId=${runId}`)
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
        queued: queueKeys(entries),
        launchedAt,
      })
      console.error(`[facts-runner-trace] launch:child:done runId=${runId} code=${child.code}`)
      if (child.timedOut || child.code !== 0) {
        await this.writeFinal(runDir, runId, "failed", child.stderr.trim() || "facts child failed")
        return { status: "failed", runId }
      }
    } catch (error) {
      await this.writeFinal(runDir, runId, "failed", describe(error))
      return { status: "failed", runId }
    }
    console.error(`[facts-runner-trace] launch:finalize:start runId=${runId}`)
    return this.finalizeRun(runDir, repo)
  }

  private reconcileRuns(): Promise<boolean> {
    return reconcileFactsRuns({
      factsDir: this.options.identity.paths.facts,
      now: this.now,
      finalize: async (runDir) => {
        const repo = new GitMemoryRepo({ dir: this.options.identity.paths.repo, agentId: this.options.identity.id })
        await this.finalizeRun(runDir, repo)
      },
      fail: (runDir, runId, detail) => this.writeFinal(runDir, runId, "failed", detail),
      warn: (message, fields) => this.options.logger?.warn(message, fields),
    })
  }

  private async finalizeRun(runDir: string, repo: GitMemoryRepo): Promise<FactsLaunchResult> {
    const ledger = await readRunJson<FactsRunLedger>(join(runDir, "ledger.json"))
    const record = await createLockRecord("facts-finalize", { runId: ledger.runId })
    return withLock(join(this.options.identity.paths.locks, `finalize-${ledger.runId}.lock`), record, async () => {
      const finalPath = join(runDir, "final.json")
      if (existsSync(finalPath)) return finalResult(await readRunJson<FactsFinalRecord>(finalPath))
      if (existsSync(join(runDir, "abandoned.json"))) return { status: "failed", runId: ledger.runId }
      return this.finalizeClaimed(runDir, repo, ledger)
    }, { waitTimeoutMs: WRITER_WAIT_MS })
  }

  private async finalizeClaimed(
    runDir: string,
    repo: GitMemoryRepo,
    ledger: FactsRunLedger,
  ): Promise<FactsLaunchResult> {
    const receipt = await findFactsBatchReceipt(repo, ledger.batchId)
    const payload = await readRunJson<FactsPayload>(join(runDir, "facts-payload.json"))
    if (receipt !== undefined) {
      await this.queue.markConsumed(payload.entries)
      await this.writeFinal(runDir, ledger.runId, "committed", undefined, receipt.sha)
      return { status: "committed", runId: ledger.runId, sha: receipt.sha }
    }
    const outcome = await readRunJson<RunOutcome>(join(runDir, "outcome.json"))
    if (outcome.timedOut || outcome.childExit.code !== 0) {
      await this.writeFinal(runDir, ledger.runId, "failed", "facts child did not exit successfully")
      return { status: "failed", runId: ledger.runId }
    }
    let records: ReturnType<typeof parseFactsExtractionJsonl>
    try {
      records = parseFactsExtractionJsonl(await readFile(join(runDir, "extraction.jsonl"), "utf8"))
    } catch (error) {
      await this.writeFinal(runDir, ledger.runId, "failed", describe(error))
      return { status: "failed", runId: ledger.runId }
    }

    if (records.length === 0) {
      await this.queue.markConsumed(payload.entries)
      await this.writeFinal(runDir, ledger.runId, "no_facts")
      return { status: "no_facts", runId: ledger.runId }
    }

    let applied
    try {
      applied = await this.applyWithRetries(runDir, ledger, repo, records)
    } catch (error) {
      await this.writeFinal(runDir, ledger.runId, "failed", describe(error))
      return { status: "failed", runId: ledger.runId }
    }
    if (applied === undefined) {
      await this.writeFinal(runDir, ledger.runId, "failed", "memory-write lock exhausted")
      return { status: "failed", runId: ledger.runId }
    }
    if (applied.outcome === "parent_dirty") {
      await this.writeFinal(
        runDir,
        ledger.runId,
        "parent_dirty",
        applied.detail ?? "memory repository contains foreign state",
      )
      return { status: "parent_dirty", runId: ledger.runId }
    }
    await this.queue.markConsumed(payload.entries)
    await this.writeFinal(runDir, ledger.runId, "committed", undefined, applied.sha)
    return { status: "committed", runId: ledger.runId, sha: applied.sha }
  }

  private applyWithRetries(
    runDir: string,
    ledger: FactsRunLedger,
    repo: GitMemoryRepo,
    records: ReturnType<typeof parseFactsExtractionJsonl>,
  ) {
    return applyFactsWithRetries({
      runDir,
      ledger,
      repo,
      records,
      people: resolveFactsPeopleRouting(this.options.loadConfig().config, this.options.identity.id),
      identity: this.options.identity,
      logger: this.options.logger,
      withWriterLock: (operation, attempt) => this.withWriterLock(operation, attempt),
      retryDelay: this.options.retryDelay,
      random: this.options.random,
    })
  }

  private async withWriterLock<T>(operation: () => Promise<T>, attempt: number): Promise<T> {
    if (this.options.withWriterLock !== undefined) return this.options.withWriterLock(operation, attempt)
    const record = await createLockRecord("memory-write", { runId: `facts-${attempt}` })
    return withLock(memoryWriterLockPath(this.options.identity.paths.locks), record, operation, {
      waitTimeoutMs: WRITER_WAIT_MS,
    })
  }

  private async writeFinal(
    runDir: string,
    runId: string,
    outcome: "committed" | "no_facts" | "failed" | "parent_dirty",
    detail?: string,
    sha?: string,
  ): Promise<void> {
    await writeFactsFinal({ runDir, runId, outcome, now: this.now, detail, sha })
  }
}
