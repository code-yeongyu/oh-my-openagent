import { existsSync } from "node:fs"
import { join } from "node:path"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  GitMemoryRepo,
  buildDefaultSeedFiles,
  createLockRecord,
  createReflectionWorktree,
  finalizeReflectionWorktree,
  installHooks,
  memoryWriterLockPath,
  withLock,
  type MemoryIdentity,
  type ReflectionFinalizeResult,
  type ReflectionOutcome,
  type ReflectionWorktree,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"
import type { SenpiModelPort, SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"

import { loadSenpiOmoConfig, type SenpiOmoConfigResult } from "../../config-resolution"
import { createOncePerSessionGuard } from "../../task/usage-guidance"
import {
  recordReflectionCompletion,
  registerReflectionCompletionRenderer,
  type ReflectionCompletionRecord,
  type ReflectionLiveSession,
} from "./completion"
import {
  resolveReflectionModel,
  shouldWarnCategoryUnavailable,
  type ReflectionModelResolution,
} from "./resolve-model"
import { prepareReflectionSpawn, runReflectionChild, type ReflectionSandbox } from "./spawn"

const DEFAULT_CATEGORY = "quick"
const DEFAULT_TIMEOUT_MINUTES = 15

export interface ReflectionReservationPort {
  complete(
    runId: string,
    outcome: ReflectionOutcome,
  ): Promise<{ readonly outcome: ReflectionOutcome; readonly launch?: ReservedRun }>
}

export interface ReflectionRunResult {
  readonly runId: string
  readonly outcome: ReflectionOutcome
  readonly reason?: string
  readonly detail?: string
  readonly completion: ReflectionCompletionRecord
  readonly launch?: ReservedRun
}

export interface ReflectionRunner {
  launch(request: ReservedRun): Promise<ReflectionRunResult>
}

export interface SenpiSubprocessRunnerOptions {
  readonly identity: MemoryIdentity
  readonly reservation: ReflectionReservationPort
  readonly resolveModelRegistry: () => SenpiModelRegistryPort<SenpiModelPort> | undefined
  readonly loadConfig?: (options?: { readonly cwd?: string }) => SenpiOmoConfigResult
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly deadlineMs?: number
  readonly terminationGraceMs?: number
  readonly maxOutputBytes?: number
  readonly sandbox?: ReflectionSandbox
  readonly liveSession?: () => ReflectionLiveSession | undefined
  readonly now?: () => Date
  readonly senpiCommand?: string
  readonly withWriterLock?: <T>(operation: () => Promise<T>) => Promise<T>
}

type ExecutionResult = {
  readonly outcome: ReflectionOutcome
  readonly reason?: string
  readonly detail?: string
}

export class SenpiSubprocessRunner implements ReflectionRunner {
  private readonly loadConfig: (options?: { readonly cwd?: string }) => SenpiOmoConfigResult
  private readonly now: () => Date
  private readonly warnedCategory = createOncePerSessionGuard()
  private readonly registeredApis = new WeakSet<object>()

  constructor(private readonly options: SenpiSubprocessRunnerOptions) {
    this.loadConfig = options.loadConfig ?? loadSenpiOmoConfig
    this.now = options.now ?? (() => new Date())
    this.ensureRenderer(options.liveSession?.())
  }

  async launch(run: ReservedRun): Promise<ReflectionRunResult> {
    const startedAt = this.now().toISOString()
    const cwd = this.options.cwd ?? process.cwd()
    const loaded = this.loadConfig({ cwd })
    const category = loaded.config.memory?.reflection.category ?? DEFAULT_CATEGORY
    const resolution = resolveReflectionModel(category, loaded.config, this.options.resolveModelRegistry())

    if (resolution.kind === "category_unavailable") {
      this.notifyCategoryUnavailable(loaded.config, resolution)
      return this.settle(run, {
        outcome: "failed",
        reason: "category_unavailable",
        detail: `Reflection category "${category}" could not resolve a usable model (cause: ${resolution.cause})`,
      }, startedAt, resolution, true)
    }

    const execution = await this.execute(run, resolution, loaded)
    return this.settle(run, execution, startedAt, resolution, false)
  }

  private async execute(
    run: ReservedRun,
    resolution: Extract<ReflectionModelResolution, { readonly kind: "resolved" }>,
    loaded: SenpiOmoConfigResult,
  ): Promise<ExecutionResult> {
    const repo = new GitMemoryRepo({ dir: this.options.identity.paths.repo, agentId: this.options.identity.id })
    if (!existsSync(join(this.options.identity.paths.repo, ".git"))) {
      await repo.init({ seedFiles: buildDefaultSeedFiles(), installHooks: (dir) => { installHooks(dir) } })
    }
    let worktree: ReflectionWorktree | undefined
    try {
      worktree = await createReflectionWorktree(repo, run.runId, this.options.identity.paths.worktrees)
      const spawnArgs = await prepareReflectionSpawn({
        run,
        worktree,
        reflectionSessionsDir: this.options.identity.paths.reflectionSessions,
        model: resolution.model,
        thinking: resolution.thinking,
        env: this.options.env ?? process.env,
        senpiCommand: this.options.senpiCommand,
      })
      const configuredMinutes = loaded.config.memory?.reflection.timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES
      const child = await runReflectionChild(spawnArgs, {
        deadlineMs: this.options.deadlineMs ?? configuredMinutes * 60_000,
        terminationGraceMs: this.options.terminationGraceMs,
        maxOutputBytes: this.options.maxOutputBytes,
        sandbox: this.options.sandbox,
      })

      if (child.timedOut) {
        const discarded = await this.discard(worktree)
        return cleanupSucceeded(discarded)
          ? { outcome: "timed_out", reason: "deadline_exceeded", detail: child.stderr.trim() || undefined }
          : { outcome: "failed", reason: "cleanup_failed", detail: discarded.detail }
      }
      if (child.code !== 0) {
        const discarded = await this.discard(worktree)
        const childDetail = child.stderr.trim() || `Reflection child exited with code ${child.code ?? "signal"}`
        return cleanupSucceeded(discarded)
          ? { outcome: "failed", reason: "child_exit", detail: childDetail }
          : { outcome: "failed", reason: "cleanup_failed", detail: [childDetail, discarded.detail].filter(Boolean).join("; ") }
      }

      const merge = loaded.config.memory?.reflection.merge ?? "auto"
      const finalized = await finalizeReflectionWorktree(
        worktree,
        merge === "auto"
          ? { mode: "auto", summary: `${run.request.trigger} ${run.runId}`, withWriterLock: (operation) => this.withWriterLock(operation) }
          : { mode: "explicit", withWriterLock: (operation) => this.withWriterLock(operation) },
      )
      return {
        outcome: finalized.status,
        ...(finalized.detail === undefined ? {} : { detail: finalized.detail }),
        ...failureReason(finalized),
      }
    } catch (error) {
      const discarded = worktree === undefined ? undefined : await this.discard(worktree)
      return {
        outcome: "failed",
        reason: discarded !== undefined && !cleanupSucceeded(discarded) ? "cleanup_failed" : "spawn_failed",
        detail: [errorMessage(error), discarded?.detail].filter(Boolean).join("; "),
      }
    }
  }

  private async settle(
    run: ReservedRun,
    result: ExecutionResult,
    startedAt: string,
    resolution: ReflectionModelResolution,
    suppressCompletionNotification: boolean,
  ): Promise<ReflectionRunResult> {
    const transition = await this.options.reservation.complete(run.runId, result.outcome)
    const live = this.options.liveSession?.()
    this.ensureRenderer(live)
    const record: ReflectionCompletionRecord = {
      schemaVersion: 1,
      runId: run.runId,
      identity: this.options.identity.id,
      category: resolution.category,
      ...(resolution.kind === "resolved" ? { model: resolution.model, thinking: resolution.thinking } : {}),
      conversationIds: run.request.conversationIds,
      outcome: result.outcome,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      startedAt,
      finishedAt: this.now().toISOString(),
      delivery: { status: "pending" },
    }
    const completion = await recordReflectionCompletion(
      join(this.options.identity.paths.reflection, "completions"),
      record,
      suppressCompletionNotification && live ? { sessionId: live.sessionId, api: live.api } : live,
    )
    return {
      runId: run.runId,
      outcome: result.outcome,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      completion,
      ...(transition.launch === undefined ? {} : { launch: transition.launch }),
    }
  }

  private notifyCategoryUnavailable(config: OmoConfig, resolution: Extract<ReflectionModelResolution, { readonly kind: "category_unavailable" }>): void {
    const live = this.options.liveSession?.()
    if (!live?.ui || !shouldWarnCategoryUnavailable(config, resolution.category)) return
    if (!this.warnedCategory(`${live.sessionId}:${resolution.category}`)) return
    const providers = resolution.missingProviders?.join(", ")
    live.ui.notify(
      providers
        ? `Category "${resolution.category}" has no usable model: none of its fallback-chain providers are connected (${providers}).`
        : `Category "${resolution.category}" has no usable model for memory reflection.`,
      "warning",
    )
  }

  private ensureRenderer(live: ReflectionLiveSession | undefined): void {
    if (!live || this.registeredApis.has(live.api)) return
    registerReflectionCompletionRenderer(live.api)
    this.registeredApis.add(live.api)
  }

  private async discard(worktree: ReflectionWorktree): Promise<ReflectionFinalizeResult> {
    return finalizeReflectionWorktree(worktree, {
      mode: "explicit",
      withWriterLock: (operation) => this.withWriterLock(operation),
    })
  }

  private async withWriterLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.options.withWriterLock) return this.options.withWriterLock(operation)
    const record = await createLockRecord("memory-write")
    return withLock(memoryWriterLockPath(this.options.identity.paths.locks), record, operation, { waitTimeoutMs: 5_000 })
  }
}

function failureReason(result: ReflectionFinalizeResult): { readonly reason?: string } {
  if (result.status === "dirty_uncommitted") return { reason: "completion_validation" }
  if (result.status === "parent_dirty" || result.status === "merge_conflict") return { reason: "integration_failed" }
  if (result.status !== "failed") return {}
  return { reason: result.detail && /Git administration|recorded launch SHA|changed paths|no HEAD commit|escapes the memory repository/i.test(result.detail)
    ? "completion_validation"
    : "integration_failed" }
}

function cleanupSucceeded(result: ReflectionFinalizeResult): boolean {
  return result.cleanup.worktreeRemoved && result.cleanup.branchRemoved
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
