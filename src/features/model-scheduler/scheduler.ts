import { log } from "../../shared/logger"
import {
  fetchAvailableModels,
  readProviderModelsCache,
  updateConnectedProvidersCache,
} from "../../shared"
import type { ModelSchedulerConfig } from "../../config"
import { collectCandidateModels } from "./candidate-models"
import { DEFAULT_MODEL_SCHEDULER_CONFIG } from "./constants"
import {
  appendModelSchedulerAuditEntry,
  readModelHealthSnapshot,
  writeModelHealthSnapshot,
} from "./health-store"
import { createModelProbeRunner } from "./model-probe"
import { readModelRoutingFile, writeModelRoutingFile } from "./routing-store"
import { buildNextFallbackList, isModelHealthy, selectReplacementModel } from "./selector"
import type {
  ModelHealthSnapshot,
  ModelProbeResult,
  ModelSchedulerAuditEntry,
  ResolvedModelSchedulerConfig,
  SchedulerChangeReason,
  RoutingTargetHealth,
  RoutingTargetKind,
  SchedulerRunResult,
} from "./types"

type SchedulerClient = {
  provider?: {
    list?: () => Promise<{
      data?: {
        connected?: string[]
        all?: Array<{ id: string; models?: Record<string, unknown> }>
      }
    }>
  }
  model?: {
    list?: () => Promise<unknown>
  }
  tui?: {
    showToast?: (input: {
      body: {
        title: string
        message: string
        variant: "info" | "success" | "warning" | "error"
        duration?: number
      }
    }) => Promise<unknown>
  }
  session?: {
    create?: (args: {
      body: { title: string; permission: Array<{ permission: string; action: "deny"; pattern: string }> }
      query: { directory: string }
    }) => Promise<{ data?: { id?: string }; error?: unknown }>
    prompt?: (args: {
      path: { id: string }
      body: {
        parts: Array<{ type: "text"; text: string }>
        tools: { task: boolean; call_omo_agent: boolean; look_at: boolean; read: boolean; question: boolean }
        model: { providerID: string; modelID: string }
      }
      signal?: AbortSignal
    }) => Promise<unknown>
    messages?: (args: { path: { id: string } }) => Promise<unknown>
  }
}

type SchedulerContext = {
  directory: string
  client: SchedulerClient
}

function resolveConfig(config?: ModelSchedulerConfig): ResolvedModelSchedulerConfig {
  return {
    enabled: config?.enabled ?? DEFAULT_MODEL_SCHEDULER_CONFIG.enabled,
    interval_minutes: config?.interval_minutes ?? DEFAULT_MODEL_SCHEDULER_CONFIG.interval_minutes,
    mode: config?.mode ?? DEFAULT_MODEL_SCHEDULER_CONFIG.mode,
    preflight_on_session_created:
      config?.preflight_on_session_created ?? DEFAULT_MODEL_SCHEDULER_CONFIG.preflight_on_session_created,
    failure_threshold: config?.failure_threshold ?? DEFAULT_MODEL_SCHEDULER_CONFIG.failure_threshold,
    recovery_threshold: config?.recovery_threshold ?? DEFAULT_MODEL_SCHEDULER_CONFIG.recovery_threshold,
    agent_cooldown_minutes:
      config?.agent_cooldown_minutes ?? DEFAULT_MODEL_SCHEDULER_CONFIG.agent_cooldown_minutes,
    protect_manual_routing:
      config?.protect_manual_routing ?? DEFAULT_MODEL_SCHEDULER_CONFIG.protect_manual_routing,
    probe_enabled: config?.probe_enabled ?? DEFAULT_MODEL_SCHEDULER_CONFIG.probe_enabled,
    probe_timeout_ms: config?.probe_timeout_ms ?? DEFAULT_MODEL_SCHEDULER_CONFIG.probe_timeout_ms,
    probe_max_latency_ms:
      config?.probe_max_latency_ms ?? DEFAULT_MODEL_SCHEDULER_CONFIG.probe_max_latency_ms,
  }
}

function getModelFailureReason(probeResult: ModelProbeResult | undefined): SchedulerChangeReason {
  if (!probeResult || !probeResult.available || probeResult.status === "unavailable") {
    return "unavailable"
  }
  if (probeResult.status === "slow") {
    return "latency-too-high"
  }
  if (probeResult.status === "error" || probeResult.status === "timeout") {
    return "probe-failed"
  }
  return "unavailable"
}

function getRoutingTargetStatus(args: {
  effectiveHealthy: boolean
  selectedHealthy: boolean
  failureReason: SchedulerChangeReason
}): RoutingTargetHealth["status"] {
  if (args.effectiveHealthy || args.selectedHealthy) {
    return "healthy"
  }
  if (args.failureReason === "latency-too-high") {
    return "degraded"
  }
  return "offline"
}

function diffInventory(
  previous: ReturnType<typeof readProviderModelsCache>,
  current: ReturnType<typeof readProviderModelsCache>,
): ModelHealthSnapshot["inventory"] {
  const added: Record<string, string[]> = {}
  const removed: Record<string, string[]> = {}

  const providerIds = new Set<string>([
    ...Object.keys(previous?.models ?? {}),
    ...Object.keys(current?.models ?? {}),
  ])

  for (const providerId of providerIds) {
    const previousModels = new Set(
      ((previous?.models?.[providerId] ?? []) as Array<string | { id?: string }>).flatMap((entry) =>
        typeof entry === "string" ? [entry] : entry?.id ? [entry.id] : [],
      ),
    )
    const currentModels = new Set(
      ((current?.models?.[providerId] ?? []) as Array<string | { id?: string }>).flatMap((entry) =>
        typeof entry === "string" ? [entry] : entry?.id ? [entry.id] : [],
      ),
    )

    const addedModels = Array.from(currentModels).filter((model) => !previousModels.has(model))
    const removedModels = Array.from(previousModels).filter((model) => !currentModels.has(model))

    if (addedModels.length > 0) added[providerId] = addedModels.sort()
    if (removedModels.length > 0) removed[providerId] = removedModels.sort()
  }

  return { added, removed }
}

function getPreviousTargetHealth(
  snapshot: ModelHealthSnapshot | null,
  kind: RoutingTargetKind,
  key: string,
): RoutingTargetHealth | null {
  if (!snapshot) return null
  return kind === "agent" ? snapshot.agents[key] ?? null : snapshot.categories[key] ?? null
}

function getCooldownUntil(previous: RoutingTargetHealth | null, cooldownMinutes: number): string | undefined {
  if (cooldownMinutes <= 0) return undefined
  if (!previous?.changed) return undefined
  const baseTime = previous.checkedAt ? Date.parse(previous.checkedAt) : Number.NaN
  if (Number.isNaN(baseTime)) return undefined
  return new Date(baseTime + cooldownMinutes * 60_000).toISOString()
}

function isCooldownActive(cooldownUntil: string | undefined, nowIso: string): boolean {
  if (!cooldownUntil) return false
  return Date.parse(cooldownUntil) > Date.parse(nowIso)
}

function nextHealthRecord(args: {
  key: string
  displayName: string
  kind: RoutingTargetKind
  currentModel: string | null
  selectedModel: string | null
  isHealthy: boolean
  selectedHealthy: boolean
  changed: boolean
  status: RoutingTargetHealth["status"]
  reason: RoutingTargetHealth["reason"]
  checkedAt: string
  previous: RoutingTargetHealth | null
  cooldownUntil?: string
  probeResult?: ModelProbeResult
  selectedProbeResult?: ModelProbeResult
}): RoutingTargetHealth {
  const previousFailures = args.previous?.consecutiveFailures ?? 0
  const previousSuccesses = args.previous?.consecutiveSuccesses ?? 0
  const currentProbe = args.probeResult
  const selectedProbe = args.selectedProbeResult

  return {
    key: args.key,
    displayName: args.displayName,
    kind: args.kind,
    currentModel: args.currentModel,
    status: args.status,
    selectedModel: args.selectedModel,
    changed: args.changed,
    reason: args.reason,
    checkedAt: args.checkedAt,
    ...(args.cooldownUntil ? { cooldownUntil: args.cooldownUntil } : {}),
    consecutiveFailures: args.status === "healthy" ? 0 : previousFailures + 1,
    consecutiveSuccesses: args.status === "healthy" ? previousSuccesses + 1 : 0,
    availabilityStatus: currentProbe?.available === false ? "unavailable" : "available",
    probeStatus: selectedProbe?.status ?? currentProbe?.status,
    probeLatencyMs: selectedProbe?.latencyMs ?? currentProbe?.latencyMs,
    probeError: selectedProbe?.error ?? currentProbe?.error,
  }
}

export async function runModelSchedulerCycle(
  ctx: SchedulerContext,
  config?: ModelSchedulerConfig,
): Promise<SchedulerRunResult | null> {
  const resolvedConfig = resolveConfig(config)
  if (!resolvedConfig.enabled) {
    log("[model-scheduler] skipped because scheduler is disabled")
    return null
  }

  const previousSnapshot = readModelHealthSnapshot()
  const previousProviderModels = readProviderModelsCache()

  await updateConnectedProvidersCache(ctx.client)

  const currentProviderModels = readProviderModelsCache()
  const availableModels = await fetchAvailableModels(ctx.client)
  const connectedProviders = currentProviderModels?.connected ?? []
  const routing = readModelRoutingFile() ?? {}
  const nextRouting = structuredClone(routing)
  const nowIso = new Date().toISOString()
  const changes: ModelSchedulerAuditEntry["changes"] = []
  const agentHealth: Record<string, RoutingTargetHealth> = {}
  const categoryHealth: Record<string, RoutingTargetHealth> = {}
  const modelsToProbe = new Set<string>()

  for (const [agentName, entry] of Object.entries(routing.agentModelMapping ?? {})) {
    for (const model of collectCandidateModels({
      kind: "agent",
      key: agentName,
      routingEntry: entry,
      currentModel: entry.primary ?? null,
      availableModels,
    })) {
      modelsToProbe.add(model)
    }
  }

  for (const [categoryName, model] of Object.entries(routing.categoryRouting ?? {})) {
    for (const candidate of collectCandidateModels({
      kind: "category",
      key: categoryName,
      currentModel: model,
      availableModels,
    })) {
      modelsToProbe.add(candidate)
    }
  }

  const probeRunner = createModelProbeRunner(ctx, resolvedConfig, availableModels)
  const probeResults = await probeRunner.probeModels(Array.from(modelsToProbe))
  const healthyModels = new Set<string>(
    Object.values(probeResults)
      .filter((result) => result.status === "healthy" || result.status === "skipped")
      .map((result) => result.model),
  )

  for (const [agentName, entry] of Object.entries(routing.agentModelMapping ?? {})) {
    const currentModel = entry.primary ?? null
    const previous = getPreviousTargetHealth(previousSnapshot, "agent", agentName)
    const cooldownUntil = getCooldownUntil(previous, resolvedConfig.agent_cooldown_minutes)
    const currentProbe = currentModel ? probeResults[currentModel] : undefined
    const healthyCurrent = isModelHealthy(currentModel, healthyModels)
    const previousFailures = previous?.consecutiveFailures ?? 0
    const previousSuccesses = previous?.consecutiveSuccesses ?? 0
    const nextSuccesses = healthyCurrent ? previousSuccesses + 1 : 0
    const meetsRecoveryThreshold = nextSuccesses >= resolvedConfig.recovery_threshold
    const effectiveHealthy = healthyCurrent && (previousFailures === 0 || meetsRecoveryThreshold)
    const nextFailures = effectiveHealthy ? 0 : previousFailures + 1
    const meetsFailureThreshold = nextFailures >= resolvedConfig.failure_threshold
    const failureReason = getModelFailureReason(currentProbe)
    const replacement = selectReplacementModel({
      kind: "agent",
      key: agentName,
      routingEntry: entry,
      currentModel,
      availableModels: healthyModels,
    })
    const canChange = !isCooldownActive(cooldownUntil, nowIso)
    const isProtected = resolvedConfig.protect_manual_routing && !!entry.reason
    const nextPrimary = effectiveHealthy || !canChange || !meetsFailureThreshold || isProtected
      ? currentModel
      : replacement.model
    const selectedProbe = nextPrimary ? probeResults[nextPrimary] : undefined
    const selectedHealthy = isModelHealthy(nextPrimary, healthyModels)
    const changed = currentModel !== nextPrimary && nextPrimary !== null
    const status = getRoutingTargetStatus({
      effectiveHealthy,
      selectedHealthy,
      failureReason,
    })

    agentHealth[agentName] = nextHealthRecord({
      key: agentName,
      displayName: agentName,
      kind: "agent",
      currentModel,
      selectedModel: nextPrimary,
      isHealthy: effectiveHealthy,
      selectedHealthy,
      changed,
      status,
      reason: effectiveHealthy ? replacement.reason : failureReason,
      checkedAt: nowIso,
      previous,
      cooldownUntil,
      probeResult: currentProbe,
      selectedProbeResult: selectedProbe,
    })

    if (resolvedConfig.mode === "active" && changed && nextRouting.agentModelMapping?.[agentName]) {
      nextRouting.agentModelMapping[agentName] = {
        ...nextRouting.agentModelMapping[agentName],
        primary: nextPrimary,
        fallback: buildNextFallbackList({
          currentPrimary: currentModel,
          selectedPrimary: nextPrimary,
          routingEntry: entry,
          availableModels,
        }),
      }

      changes.push({
        kind: "agent",
        key: agentName,
        from: currentModel,
        to: nextPrimary,
        reason: failureReason,
      })
    }
  }

  for (const [categoryName, model] of Object.entries(routing.categoryRouting ?? {})) {
    const previous = getPreviousTargetHealth(previousSnapshot, "category", categoryName)
    const cooldownUntil = getCooldownUntil(previous, resolvedConfig.agent_cooldown_minutes)
    const currentProbe = model ? probeResults[model] : undefined
    const healthyCurrent = isModelHealthy(model, healthyModels)
    const previousFailures = previous?.consecutiveFailures ?? 0
    const previousSuccesses = previous?.consecutiveSuccesses ?? 0
    const nextSuccesses = healthyCurrent ? previousSuccesses + 1 : 0
    const meetsRecoveryThreshold = nextSuccesses >= resolvedConfig.recovery_threshold
    const effectiveHealthy = healthyCurrent && (previousFailures === 0 || meetsRecoveryThreshold)
    const nextFailures = effectiveHealthy ? 0 : previousFailures + 1
    const meetsFailureThreshold = nextFailures >= resolvedConfig.failure_threshold
    const failureReason = getModelFailureReason(currentProbe)
    const replacement = selectReplacementModel({
      kind: "category",
      key: categoryName,
      currentModel: model,
      availableModels: healthyModels,
    })
    const canChange = !isCooldownActive(cooldownUntil, nowIso)
    const nextModel = effectiveHealthy || !canChange || !meetsFailureThreshold
      ? model
      : replacement.model
    const selectedProbe = nextModel ? probeResults[nextModel] : undefined
    const selectedHealthy = isModelHealthy(nextModel, healthyModels)
    const changed = model !== nextModel && nextModel !== null
    const status = getRoutingTargetStatus({
      effectiveHealthy,
      selectedHealthy,
      failureReason,
    })

    categoryHealth[categoryName] = nextHealthRecord({
      key: categoryName,
      displayName: categoryName,
      kind: "category",
      currentModel: model,
      selectedModel: nextModel,
      isHealthy: effectiveHealthy,
      selectedHealthy,
      changed,
      status,
      reason: effectiveHealthy ? replacement.reason : failureReason,
      checkedAt: nowIso,
      previous,
      cooldownUntil,
      probeResult: currentProbe,
      selectedProbeResult: selectedProbe,
    })

    if (resolvedConfig.mode === "active" && changed && nextRouting.categoryRouting) {
      nextRouting.categoryRouting[categoryName] = nextModel
      changes.push({
        kind: "category",
        key: categoryName,
        from: model,
        to: nextModel,
        reason: failureReason,
      })
    }
  }

  nextRouting.lastUpdated = nowIso.slice(0, 10)
  nextRouting.scheduler = {
    lastRunAt: nowIso,
    lastMode: resolvedConfig.mode,
    lastChangeCount: changes.length,
  }

  if (resolvedConfig.mode === "active" && changes.length > 0) {
    writeModelRoutingFile(nextRouting)
  }

  const snapshot: ModelHealthSnapshot = {
    version: 2,
    mode: resolvedConfig.mode,
    updatedAt: nowIso,
    connectedProviders,
    availableModelCount: availableModels.size,
    inventory: diffInventory(previousProviderModels, currentProviderModels),
    agents: agentHealth,
    categories: categoryHealth,
    probe: {
      enabled: resolvedConfig.probe_enabled,
      timeoutMs: resolvedConfig.probe_timeout_ms,
      maxLatencyMs: resolvedConfig.probe_max_latency_ms,
      checkedModelCount: Object.keys(probeResults).length,
      healthyModelCount: Object.values(probeResults).filter((result) =>
        result.status === "healthy" || result.status === "skipped").length,
      models: probeResults,
    },
  }
  const auditEntry: ModelSchedulerAuditEntry = {
    timestamp: nowIso,
    mode: resolvedConfig.mode,
    changed: changes.length > 0,
    availableModelCount: availableModels.size,
    connectedProviders,
    probeSummary: {
      enabled: resolvedConfig.probe_enabled,
      checkedModelCount: Object.keys(probeResults).length,
      healthyModelCount: Object.values(probeResults).filter((result) =>
        result.status === "healthy" || result.status === "skipped").length,
    },
    changes,
  }

  writeModelHealthSnapshot(snapshot)
  appendModelSchedulerAuditEntry(auditEntry)

  if (changes.length > 0) {
    log("[model-scheduler] applied routing changes", { changes })
    await ctx.client.tui?.showToast?.({
      body: {
        title: "Model Scheduler",
        message: `Adjusted ${changes.length} routing entr${changes.length === 1 ? "y" : "ies"} after health check.`,
        variant: "info",
        duration: 6000,
      },
    })
  } else {
    log("[model-scheduler] completed without routing changes", {
      availableModelCount: availableModels.size,
      connectedProviders,
    })
  }

  return { snapshot, auditEntry }
}

export function getModelSchedulerIntervalMs(config?: ModelSchedulerConfig): number {
  return resolveConfig(config).interval_minutes * 60_000
}
