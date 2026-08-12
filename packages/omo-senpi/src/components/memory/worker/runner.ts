import { existsSync } from "node:fs"
import { join } from "node:path"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  GitMemoryRepo,
  buildDefaultSeedFiles,
  cleanupReflectionWorktree,
  installHooks,
  type ReflectionFinalizeResult,
  type ReflectionWorktree,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"
import { loadSenpiOmoConfig, type SenpiOmoConfigResult } from "../../config-resolution"
import { resolveAgentReflectionSettings } from "../reflection-settings"
import { createOncePerSessionGuard } from "../../task/usage-guidance"
import {
  REFLECTION_LAUNCHED_ENTRY_TYPE,
  recordReflectionCompletion,
  registerReflectionCompletionRenderer,
  safeNotify,
  type ReflectionCompletionRecord,
  type ReflectionLiveSession,
} from "./completion"
import { emitReflectionHealthAlert, readReflectionHealth } from "./health"
import {
  resolveReflectionModel,
  shouldWarnCategoryUnavailable,
  type ReflectionModelResolution,
} from "./resolve-model"
import {
  MemoryModelExhaustedError,
  runMemoryModelAttempts,
  type MemoryModelChain,
} from "./memory-model-attempts"
import { preflightMemoryModels } from "./model-preflight"
import { resolveSenpiLaunch } from "./senpi-command"
import { createRunWorktree } from "./create-run-worktree"
import { prepareReflectionCandidateSpawn } from "./reflection-spawn-input"
import { readRunJson } from "./run-artifacts"
import { failReservationRun, finalizeRecordedOutcome, overrideFailedReservationRun } from "./run-finalization"
import type { RunFinalizationContext } from "./run-finalization-types"
import { parseReservationRunLedger } from "./reservation-run-ledger"
import { requireFinalizedResult } from "./runner-finalization-result"
import { runReflectionChild } from "./spawn"

export type {
  ReflectionReservationPort,
  ReflectionRunResult,
  ReflectionRunner,
  SenpiSubprocessRunnerOptions,
} from "./runner-types"

import { cleanupSucceeded, errorMessage } from "./runner-results"
import type { ExecutionResult, ReflectionRunResult, ReflectionRunner, SenpiSubprocessRunnerOptions } from "./runner-types"

export class SenpiSubprocessRunner implements ReflectionRunner {
  private readonly loadConfig: (options?: { readonly cwd?: string }) => SenpiOmoConfigResult
  private readonly now: () => Date
  private readonly warnedCategory = createOncePerSessionGuard()
  private readonly warnedHealth = createOncePerSessionGuard()
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
    const reflection = resolveAgentReflectionSettings(loaded.config.memory, this.options.identity.id)
    const category = reflection.category
    const resolution = resolveReflectionModel(category, loaded.config, this.options.resolveModelRegistry())

    if (resolution.kind === "category_unavailable") {
      this.notifyCategoryUnavailable(loaded.config, resolution)
      return this.settle(run, {
        outcome: "failed",
        reason: "category_unavailable",
        detail: `Reflection category "${category}" could not resolve a usable model (cause: ${resolution.cause})`,
      }, startedAt, resolution, true)
    }

    const execution = await this.execute(run, resolution, loaded, startedAt)
    if ("runId" in execution) return this.deliverFinalized(execution)
    const settled = await this.settle(run, execution, startedAt, resolution, false)
    return settled
  }

  private async execute(
    run: ReservedRun,
    resolution: Extract<ReflectionModelResolution, { readonly kind: "resolved" }>,
    loaded: SenpiOmoConfigResult,
    startedAt: string,
  ): Promise<ExecutionResult | ReflectionRunResult> {
    const repo = new GitMemoryRepo({ dir: this.options.identity.paths.repo, agentId: this.options.identity.id })
    if (!existsSync(join(this.options.identity.paths.repo, ".git"))) {
      await repo.init({ seedFiles: buildDefaultSeedFiles(), installHooks: (dir) => { installHooks(dir) } })
    }
    let worktree: ReflectionWorktree | undefined
    try {
      worktree = await createRunWorktree(repo, run.runId, this.options.identity.paths)
      const activeWorktree = worktree
      const reflection = resolveAgentReflectionSettings(loaded.config.memory, this.options.identity.id)
      const merge = reflection.merge
      const hardDeadlineAt = Date.now() + (this.options.deadlineMs ?? reflection.timeout_minutes * 60_000)
      const candidates: MemoryModelChain = [
        {
          model: resolution.model,
          ...(resolution.thinking === undefined ? {} : { thinking: resolution.thinking }),
        },
        ...resolution.fallbacks,
      ]
      const env = this.options.env ?? process.env
      const launch = this.options.senpiCommand === undefined
        ? resolveSenpiLaunch(env)
        : { command: this.options.senpiCommand, prefixArgs: this.options.senpiPrefixArgs ?? [] }
      const preflight = await preflightMemoryModels({
        candidates,
        launch,
        env: { ...env, SENPI_MEMORY_REFLECTION: "1", SENPI_PTY_FORCE_PIPE: "1" },
        configSources: loaded.sources,
        warn: (message, details) => this.options.logger?.warn(message, details),
      })
      if (preflight.kind === "none_visible") {
        throw new Error(`No reflection model candidate is visible to the discovery-disabled child: ${preflight.rejected.map((item) => `${item.model} (${item.cause})`).join(", ")}`)
      }
      let launched = false
      await runMemoryModelAttempts(preflight.candidates, async (candidate, attemptNumber, nextAttempt) => {
        const spawnArgs = await prepareReflectionCandidateSpawn({
          run,
          worktree: activeWorktree,
          mergePolicy: merge,
          category: reflection.category,
          candidate,
          attempt: attemptNumber,
          hardDeadlineAt,
          nextAttempt,
          config: loaded.config,
          identity: this.options.identity,
          env,
          senpiCommand: this.options.senpiCommand,
        })
        if (!launched) {
          await this.appendLaunched(run, resolution, startedAt)
          launched = true
        }
        return runReflectionChild(spawnArgs, {
          terminationGraceMs: this.options.terminationGraceMs,
          maxOutputBytes: this.options.maxOutputBytes,
          sandbox: this.options.sandbox,
          supervisorPath: this.options.supervisorPath,
        })
      })
    } catch (error) {
      const runDir = join(this.options.identity.paths.reflection, "runs", run.runId)
      if (existsSync(join(runDir, "ledger.json"))) {
        const ledger = parseReservationRunLedger(await readRunJson<unknown>(join(runDir, "ledger.json")))
        const finalized = error instanceof MemoryModelExhaustedError
          ? await overrideFailedReservationRun(this.finalizationContext(), runDir, ledger, error.message)
          : await failReservationRun(
              this.finalizationContext(),
              runDir,
              ledger,
              "failed",
              errorMessage(error),
            )
        return requireFinalizedResult(finalized)
      }
      const discarded = worktree === undefined ? undefined : await this.discard(worktree)
      return {
        outcome: "failed",
        reason: discarded !== undefined && !cleanupSucceeded(discarded) ? "cleanup_failed" : "spawn_failed",
        detail: [errorMessage(error), discarded?.detail].filter(Boolean).join("; "),
      }
    }
    const runDir = join(this.options.identity.paths.reflection, "runs", run.runId)
    const ledger = parseReservationRunLedger(await readRunJson<unknown>(join(runDir, "ledger.json")))
    const finalized = await finalizeRecordedOutcome(this.finalizationContext(), runDir, ledger)
    return requireFinalizedResult(finalized)
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
    const finishedAt = this.now().toISOString()
    const healthBefore = await readReflectionHealth(join(this.options.identity.paths.reflection, "completions"))
    const record: ReflectionCompletionRecord = {
      schemaVersion: 1,
      runId: run.runId,
      identity: this.options.identity.id,
      category: resolution.category,
      ...(resolution.kind === "resolved"
        ? {
            model: result.model ?? resolution.model,
            ...(result.model === undefined
              ? resolution.thinking === undefined ? {} : { thinking: resolution.thinking }
              : result.thinking === undefined ? {} : { thinking: result.thinking }),
          }
        : {}),
      conversationIds: run.request.conversationIds,
      trigger: run.request.trigger,
      ...(run.request.trigger === "dream" ? { origin: run.request.origin } : {}),
      outcome: result.outcome,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      startedAt,
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      consecutiveFailures: result.outcome === "failed" ? healthBefore.streak + 1 : 0,
      delivery: { status: "pending" },
    }
    const completionsDir = join(this.options.identity.paths.reflection, "completions")
    const completion = await recordReflectionCompletion(
      completionsDir,
      record,
      suppressCompletionNotification && live
        ? { sessionId: live.sessionId, api: live.api, logger: live.logger }
        : live,
    )
    await emitReflectionHealthAlert(completionsDir, this.options.identity.id, live, this.warnedHealth)
    return {
      runId: run.runId,
      outcome: result.outcome,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      completion,
      ...(transition.launch === undefined ? {} : { launch: transition.launch }),
    }
  }

  private async deliverFinalized(result: ReflectionRunResult): Promise<ReflectionRunResult> {
    const live = this.options.liveSession?.()
    this.ensureRenderer(live)
    const finishedAt = result.completion.finishedAt
    const health = await readReflectionHealth(join(this.options.identity.paths.reflection, "completions"))
    const completionsDir = join(this.options.identity.paths.reflection, "completions")
    const completion = await recordReflectionCompletion(
      completionsDir,
      {
        ...result.completion,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(result.completion.startedAt)),
        ...(result.completion.outcome === "merged"
          ? await this.mergedMetadata(result.completion.runId)
          : {}),
        consecutiveFailures: result.completion.outcome === "failed" ? health.streak : 0,
      },
      live,
    )
    await emitReflectionHealthAlert(completionsDir, this.options.identity.id, live, this.warnedHealth)
    return { ...result, completion }
  }

  private async appendLaunched(
    run: ReservedRun,
    resolution: Extract<ReflectionModelResolution, { readonly kind: "resolved" }>,
    startedAt: string,
  ): Promise<void> {
    const live = this.options.liveSession?.()
    if (!live) return
    const states = this.options.getTranscriptState === undefined
      ? []
      : await Promise.all(run.request.conversationIds.map((id) => this.options.getTranscriptState?.(id)))
    const backlogSteps = states.reduce(
      (sum, state) => sum + (state?.steps_since_last_successful_reflection ?? 0),
      0,
    )
    live.api.appendEntry(REFLECTION_LAUNCHED_ENTRY_TYPE, {
      schemaVersion: 1,
      runId: run.runId,
      identity: this.options.identity.id,
      trigger: run.request.trigger,
      category: resolution.category,
      model: resolution.model,
      ...(resolution.thinking === undefined ? {} : { thinking: resolution.thinking }),
      conversationIds: run.request.conversationIds,
      backlogSteps,
      startedAt,
    })
  }

  private async mergedMetadata(runId: string): Promise<{ mergedCommitSha?: string; filesChanged?: number }> {
    try {
      const ledger = parseReservationRunLedger(await readRunJson<unknown>(
        join(this.options.identity.paths.reflection, "runs", runId, "ledger.json"),
      ))
      return {
        ...(ledger.integrationSha === undefined ? {} : { mergedCommitSha: ledger.integrationSha }),
        filesChanged: ledger.validatedChangedPaths?.length ?? 0,
      }
    } catch {
      return {}
    }
  }

  private notifyCategoryUnavailable(config: OmoConfig, resolution: Extract<ReflectionModelResolution, { readonly kind: "category_unavailable" }>): void {
    const live = this.options.liveSession?.()
    if (!live?.ui || !shouldWarnCategoryUnavailable(config, resolution.category)) return
    if (!this.warnedCategory(`${live.sessionId}:${resolution.category}`)) return
    const providers = resolution.missingProviders?.join(", ")
    safeNotify(
      live,
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
    const cleanup = await cleanupReflectionWorktree(worktree)
    return { status: "failed", cleanup }
  }

  private finalizationContext(): RunFinalizationContext {
    return {
      identity: this.options.identity,
      reservation: this.options.reservation,
      now: () => this.now().getTime(),
      ...(this.options.withWriterLock === undefined
        ? {}
        : { withWriterLock: this.options.withWriterLock }),
    }
  }
}
