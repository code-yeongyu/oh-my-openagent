import type { BackgroundTask, LaunchInput } from "./types"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient, QueueItem } from "./constants"
import { isProviderExhaustionFallbackEligible } from "@oh-my-opencode/model-core"
import { log, readConnectedProvidersCache, readProviderModelsCache } from "../../shared"
import {
  shouldRetryError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProvider,
} from "../../shared/model-error-classifier"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import { abortWithTimeout } from "./abort-with-timeout"
import { ensureCurrentAttempt, scheduleRetryAttempt } from "./attempt-lifecycle"

export class TeamModeFallbackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TeamModeFallbackError"
  }
}

function canonicalizeModelID(modelID: string): string {
  return modelID.toLowerCase().replace(/\./g, "-")
}

export type FallbackRetryHandlerDeps = {
  log: typeof log
  readProviderModelsCache: typeof readProviderModelsCache
  readConnectedProvidersCache: typeof readConnectedProvidersCache
  shouldRetryError: typeof shouldRetryError
  getNextFallback: typeof getNextFallback
  hasMoreFallbacks: typeof hasMoreFallbacks
  selectFallbackProvider: typeof selectFallbackProvider
  transformModelForProvider: typeof transformModelForProvider
  isProviderExhaustionFallbackEligible: (error: unknown) => boolean
}

const defaultFallbackRetryHandlerDeps: FallbackRetryHandlerDeps = {
  log,
  readProviderModelsCache,
  readConnectedProvidersCache,
  shouldRetryError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProvider,
  transformModelForProvider,
  isProviderExhaustionFallbackEligible,
}

export async function tryFallbackRetry(args: {
  task: BackgroundTask
  errorInfo: { name?: string; message?: string; statusCode?: number }
  source: string
  concurrencyManager: ConcurrencyManager
  client: OpencodeClient
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  queuesByKey: Map<string, QueueItem[]>
  processKey: (key: string) => void
  isShuttingDown?: () => boolean
  onRetrying?: (details: {
    task: BackgroundTask
    source: string
    previousSessionID?: string
    failedModel?: string
    failedError?: string
    nextModel: string
  }) => void
  deps?: Partial<FallbackRetryHandlerDeps>
}): Promise<boolean> {
  const { task, errorInfo, source, concurrencyManager, client, idleDeferralTimers, queuesByKey, processKey, onRetrying } = args
  const deps = { ...defaultFallbackRetryHandlerDeps, ...args.deps }
  if (args.isShuttingDown?.()) return false
  const fallbackChain = task.fallbackChain
  const canUseProviderExhaustionFallback = deps.isProviderExhaustionFallbackEligible(errorInfo)
  const canRetry =
    (deps.shouldRetryError(errorInfo) || canUseProviderExhaustionFallback) &&
    fallbackChain &&
    fallbackChain.length > 0 &&
    deps.hasMoreFallbacks(fallbackChain, task.attemptCount ?? 0)

  if (!canRetry) return false

  const attemptCount = task.attemptCount ?? 0
  const providerModelsCache = deps.readProviderModelsCache()
  const connectedProviders = providerModelsCache?.connected ?? deps.readConnectedProvidersCache()
  const connectedSet = connectedProviders ? new Set(connectedProviders.map(p => p.toLowerCase())) : null

  const isReachable = (entry: FallbackEntry): boolean => {
    if (!connectedSet) return true
    return entry.providers.some((provider) => connectedSet.has(provider.toLowerCase()))
  }

  let selectedAttemptCount = attemptCount
  let nextFallback: FallbackEntry | undefined
  let nextProviderID: string | undefined
  while (fallbackChain && selectedAttemptCount < fallbackChain.length) {
    const candidate = deps.getNextFallback(fallbackChain, selectedAttemptCount)
    if (!candidate) break
    selectedAttemptCount++
    if (!isReachable(candidate)) {
      deps.log("[background-agent] Skipping unreachable fallback:", {
        taskId: task.id,
        source,
        model: candidate.model,
        providers: candidate.providers,
      })
      continue
    }
    const candidateProviderID = deps.selectFallbackProvider(
      candidate.providers,
      task.model?.providerID,
    )
    const candidateModelID = deps.transformModelForProvider(candidateProviderID, candidate.model)
    const isNoOpFallback =
      !!task.model &&
      candidateProviderID.toLowerCase() === task.model.providerID.toLowerCase() &&
      canonicalizeModelID(candidateModelID) === canonicalizeModelID(task.model.modelID)
    if (isNoOpFallback) {
      deps.log("[background-agent] Skipping no-op fallback:", {
        taskId: task.id,
        source,
        model: candidate.model,
        providers: candidate.providers,
      })
      continue
    }
    nextFallback = candidate
    nextProviderID = candidateProviderID
    break
  }
  if (!nextFallback) return false

  const providerID = nextProviderID ?? deps.selectFallbackProvider(
    nextFallback.providers,
    task.model?.providerID,
  )

  deps.log("[background-agent] Retryable error, attempting fallback:", {
    taskId: task.id,
    source,
    errorName: errorInfo.name,
    errorMessage: errorInfo.message?.slice(0, 100),
    attemptCount: selectedAttemptCount,
    nextModel: `${providerID}/${nextFallback.model}`,
  })

  if (task.concurrencyKey) {
    concurrencyManager.release(task.concurrencyKey)
    task.concurrencyKey = undefined
  }

  const idleTimer = idleDeferralTimers.get(task.id)
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleDeferralTimers.delete(task.id)
  }

  const previousSessionID = task.sessionId
  const previousModel = task.model

  const transformedModelId = deps.transformModelForProvider(providerID, nextFallback.model)
  const nextModel = {
    providerID,
    modelID: transformedModelId,
    variant: nextFallback.variant,
  }
  task.attemptCount = selectedAttemptCount
  const failedAttemptID = ensureCurrentAttempt(task, previousModel).attemptId
  const nextAttempt = failedAttemptID
    ? scheduleRetryAttempt(task, failedAttemptID, nextModel, errorInfo.message)
    : undefined
  if (!nextAttempt) {
    return false
  }

  task.queuedAt = new Date()
  task.retryNotification = {
    previousSessionID,
    failedModel: previousModel ? `${previousModel.providerID}/${previousModel.modelID}` : undefined,
    failedError: errorInfo.message,
    nextModel: `${providerID}/${transformedModelId}`,
  }

  onRetrying?.({
    task,
    source,
    previousSessionID,
    failedModel: task.retryNotification.failedModel,
    failedError: errorInfo.message,
    nextModel: `${providerID}/${transformedModelId}`,
  })

  // Guard: a team-mode task (teamRunId set) MUST carry an onSessionCreated callback so
  // the fallback session gets registered in the team-session registry under the original
  // member slot. Without it the new session would not appear as a team participant and
  // every subsequent team tool call would throw "not in team". Fail with a bounded
  // structured error instead of silently entering that confusing runtime state.
  if (task.teamRunId && !task.onSessionCreated) {
    deps.log("[background-agent] team-mode fallback denied: task has teamRunId but no onSessionCreated; cannot preserve team membership", {
      taskId: task.id,
      teamRunId: task.teamRunId,
    })
    throw new TeamModeFallbackError(
      `team-mode fallback denied: cannot preserve team context for task ${task.id} (teamRunId=${task.teamRunId})`,
    )
  }

  const rawKey = task.model ? `${task.model.providerID}/${task.model.modelID}` : task.agent
  const key = concurrencyManager.getConcurrencyKey(rawKey)
  const queue = queuesByKey.get(key) ?? []
  const retryInput: LaunchInput = {
    description: task.description,
    prompt: task.prompt,
    agent: task.agent,
    parentSessionId: task.parentSessionId,
    parentMessageId: task.parentMessageId,
    parentModel: task.parentModel,
    parentAgent: task.parentAgent,
    parentTools: task.parentTools,
    teamRunId: task.teamRunId,
    model: nextModel,
    fallbackChain: task.fallbackChain,
    skillContent: task.skillContent,
    sessionPermission: task.sessionPermission,
    userPermission: task.userPermission,
    category: task.category,
    isUnstableAgent: task.isUnstableAgent,
    onSessionCreated: task.onSessionCreated,
  }

  if (previousSessionID) {
    await abortWithTimeout(client, previousSessionID).catch(() => {})
  }

  if (args.isShuttingDown?.()) return false

  queue.push({ task, input: retryInput, attemptID: nextAttempt.attemptId, rawConcurrencyKey: rawKey })
  queuesByKey.set(key, queue)
  processKey(key)
  return true
}
