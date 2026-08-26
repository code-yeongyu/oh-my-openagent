import { join } from "node:path"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ReservedRun } from "@oh-my-opencode/memory-core"
import { loadSenpiOmoConfig, type SenpiOmoConfigResult } from "../../config-resolution"
import { resolveAgentReflectionSettings } from "../reflection-settings"
import { createOncePerSessionGuard } from "../../task/usage-guidance"
import {
  REFLECTION_LAUNCHED_ENTRY_TYPE,
  registerReflectionCompletionRenderer,
  safeNotify,
  type ReflectionLiveSession,
} from "./completion"
import {
  chooseMemoryLaunchRoute,
  MEMORY_WORKLOAD_PROFILES,
  type MemoryLaunchRoute,
  type MemoryLaunchSurface,
} from "./fork-cost"
import { readModelPricing } from "./registry-fallback"
import {
  resolveReflectionModel,
  shouldWarnCategoryUnavailable,
  type ReflectionModelResolution,
  type ReflectionSessionModel,
} from "./resolve-model"
import { readRunJson } from "./run-artifacts"
import type { RunFinalizationContext } from "./run-finalization-types"
import { parseReservationRunLedger } from "./reservation-run-ledger"
import {
  publishFinalizedReflectionRun,
  settleReflectionRun,
} from "./runner-completion-publication"
import { executeReflectionRun } from "./runner-execution"

export type {
  ReflectionReservationPort,
  ReflectionRunResult,
  ReflectionRunner,
  SenpiSubprocessRunnerOptions,
} from "./runner-types"

import type { ExecutionResult, ReflectionRunResult, ReflectionRunner, SenpiSubprocessRunnerOptions } from "./runner-types"

function quickCandidateCost(model: string, registry: ReturnType<SenpiSubprocessRunnerOptions["resolveModelRegistry"]>) {
  if (registry === undefined) return undefined
  const separator = model.indexOf("/")
  if (separator <= 0) return undefined
  return readModelPricing(registry.find(model.slice(0, separator), model.slice(separator + 1)))
}

// missing_providers rides the failure detail so the health fingerprint and the remediation hint
// can name what to connect; the fingerprint truncates at 60 chars, keeping it stable.
function categoryUnavailableDetail(
  category: string,
  resolution: Extract<ReflectionModelResolution, { readonly kind: "category_unavailable" }>,
): string {
  const base = `Reflection category "${category}" could not resolve a usable model (cause: ${resolution.cause})`
  const providers = resolution.missingProviders?.join(", ")
  return providers === undefined || providers.length === 0 ? base : `${base}; missing providers: ${providers}`
}

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
    const registry = this.options.resolveModelRegistry()
    const sessionModel = this.options.resolveSessionModel?.()
    const resolution = resolveReflectionModel(category, loaded.config, registry, {
      ...(sessionModel === undefined ? {} : { sessionModel }),
    })

    if (resolution.kind === "category_unavailable") {
      this.notifyCategoryUnavailable(loaded.config, resolution)
      return this.settle(run, {
        outcome: "failed",
        reason: "category_unavailable",
        detail: categoryUnavailableDetail(category, resolution),
      }, startedAt, resolution, true)
    }

    const route = this.chooseLaunchRoute(run, resolution, registry, sessionModel)

    const execution = await executeReflectionRun({
      run,
      resolution,
      route,
      loaded,
      startedAt,
      options: this.options,
      now: () => this.now().getTime(),
      finalizationContext: () => this.finalizationContext(),
      appendLaunched: () => this.appendLaunched(run, resolution, startedAt),
    })
    if ("runId" in execution) return this.deliverFinalized(execution)
    return this.settle(run, execution, startedAt, resolution, false)
  }

  // Fork-vs-quick is orthogonal to category resolution: even a user with a working quick chain
  // should fork when the session model's cache reads are cheap and the job is short. The resolved
  // quick candidate is compared against fork+inherit on measured per-turn cost; facts never forks.
  private chooseLaunchRoute(
    run: ReservedRun,
    resolution: Extract<ReflectionModelResolution, { readonly kind: "resolved" }>,
    registry: ReturnType<SenpiSubprocessRunnerOptions["resolveModelRegistry"]>,
    sessionModel: ReflectionSessionModel | undefined,
  ): MemoryLaunchRoute {
    const surface: MemoryLaunchSurface = run.request.trigger === "dream" ? "dream" : "reflection"
    const quickCost = quickCandidateCost(resolution.model, registry)
    const sessionCost = sessionModel === undefined || registry === undefined
      ? undefined
      : readModelPricing(registry.find(sessionModel.provider, sessionModel.id))
    const parentContextTokens = this.options.resolveParentContextTokens?.()
    return chooseMemoryLaunchRoute({
      surface,
      quick: {
        model: resolution.model,
        ...(resolution.thinking === undefined ? {} : { thinking: resolution.thinking }),
        ...(quickCost === undefined ? {} : { cost: quickCost }),
      },
      ...(sessionModel === undefined || sessionCost === undefined
        ? {}
        : {
            session: {
              model: `${sessionModel.provider}/${sessionModel.id}`,
              ...(sessionModel.thinking === undefined ? {} : { thinking: sessionModel.thinking }),
              cost: sessionCost,
            },
          }),
      ...(parentContextTokens === undefined ? {} : { parentContextTokens }),
      turns: MEMORY_WORKLOAD_PROFILES[surface].turns,
      cacheHit: this.options.resolveParentCacheReusable?.() ?? false,
    })
  }

  private settle(
    run: ReservedRun,
    result: ExecutionResult,
    startedAt: string,
    resolution: ReflectionModelResolution,
    suppressCompletionNotification: boolean,
  ): Promise<ReflectionRunResult> {
    return settleReflectionRun({
      run,
      result,
      startedAt,
      resolution,
      suppressCompletionNotification,
      options: this.options,
      now: this.now,
      ensureRenderer: (live) => this.ensureRenderer(live),
      warnedHealth: this.warnedHealth,
    })
  }

  private deliverFinalized(result: ReflectionRunResult): Promise<ReflectionRunResult> {
    return publishFinalizedReflectionRun({
      result,
      options: this.options,
      ensureRenderer: (live) => this.ensureRenderer(live),
      mergedMetadata: (runId) => this.mergedMetadata(runId),
      warnedHealth: this.warnedHealth,
    })
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
      "info",
    )
  }

  private ensureRenderer(live: ReflectionLiveSession | undefined): void {
    if (!live || this.registeredApis.has(live.api)) return
    registerReflectionCompletionRenderer(live.api)
    this.registeredApis.add(live.api)
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
