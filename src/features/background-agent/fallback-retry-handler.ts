import type { BackgroundTask, LaunchInput } from "./types"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient, QueueItem } from "./constants"
import { log, readConnectedProvidersCache, readProviderModelsCache } from "../../shared"
import {
  shouldRetryError,
  isUsageLimitError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProvider,
} from "../../shared/model-error-classifier"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import { abortWithTimeout } from "./abort-with-timeout"

export async function tryFallbackRetry(args: {
  task: BackgroundTask
  errorInfo: { name?: string; message?: string }
  source: string
  concurrencyManager: ConcurrencyManager
  client: OpencodeClient
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  queuesByKey: Map<string, QueueItem[]>
  processKey: (key: string) => void
  /** Called when a usage-limit error is cancelled (no ignore_usage_limit). Delivers a message to the parent session. */
  onUsageLimitCancel?: (message: string) => void
}): Promise<boolean> {
  const { task, errorInfo, source, concurrencyManager, client, idleDeferralTimers, queuesByKey, processKey } = args
  const usageLimitErr = isUsageLimitError(errorInfo)
  const fallbackChain = task.fallbackChain
  const canRetry =
    (shouldRetryError(errorInfo) || usageLimitErr) &&
    fallbackChain &&
    fallbackChain.length > 0 &&
    hasMoreFallbacks(fallbackChain, task.attemptCount ?? 0)

  if (!canRetry) return false

  const attemptCount = task.attemptCount ?? 0
  const providerModelsCache = readProviderModelsCache()
  const connectedProviders = providerModelsCache?.connected ?? readConnectedProvidersCache()
  const connectedSet = connectedProviders ? new Set(connectedProviders.map(p => p.toLowerCase())) : null
  const preferredProvider = task.model?.providerID?.toLowerCase()

  const isReachable = (entry: FallbackEntry): boolean => {
    if (!connectedSet) return true
    if (entry.providers.some((provider) => connectedSet.has(provider.toLowerCase()))) {
      return true
    }
    return preferredProvider ? connectedSet.has(preferredProvider) : false
  }

  let selectedAttemptCount = attemptCount
  let nextFallback: FallbackEntry | undefined
  while (fallbackChain && selectedAttemptCount < fallbackChain.length) {
    const candidate = getNextFallback(fallbackChain, selectedAttemptCount)
    if (!candidate) break
    selectedAttemptCount++
    if (!isReachable(candidate)) {
      log("[background-agent] Skipping unreachable fallback:", {
        taskId: task.id,
        source,
        model: candidate.model,
        providers: candidate.providers,
      })
      continue
    }
    nextFallback = candidate
    break
  }
  if (!nextFallback) return false

  // Usage-limit stop errors are not automatically retried to avoid spending on a
  // different provider without user consent.  The only exception is when the next
  // fallback entry is explicitly marked with `ignore_usage_limit: true`.
  if (usageLimitErr && !nextFallback.ignore_usage_limit) {
    const currentModel = task.model
      ? `${task.model.providerID}/${task.model.modelID}`
      : "current model"
    const nextModel = `${nextFallback.providers[0] ?? "?"}/${nextFallback.model}`
    const message =
      `⚠️ **Usage limit reached** for \`${currentModel}\` (task \`${task.id}\`: "${task.description}").\n` +
      `Automatic fallback to \`${nextModel}\` was **blocked** to prevent unintended spending.\n\n` +
      `To enable automatic fallback for this model, add \`"ignore_usage_limit": true\` to the relevant entry in \`fallback_models\`.\n` +
      `The task has been cancelled.`
    log("[background-agent] Usage-limit error — cancelling instead of falling back:", {
      taskId: task.id,
      source,
      currentModel,
      nextModel,
    })
    args.onUsageLimitCancel?.(message)
    return false
  }

  const providerID = selectFallbackProvider(
    nextFallback.providers,
    task.model?.providerID,
  )

  log(`[background-agent] ${usageLimitErr ? "Usage-limit error with ignore_usage_limit=true" : "Retryable error"}, attempting fallback:`, {
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

  const previousSessionID = task.sessionID

  task.attemptCount = selectedAttemptCount
  const transformedModelId = transformModelForProvider(providerID, nextFallback.model)
  task.model = {
    providerID,
    modelID: transformedModelId,
    variant: nextFallback.variant,
  }
  task.status = "pending"
  task.sessionID = undefined
  task.startedAt = undefined
  task.queuedAt = new Date()
  task.error = undefined

  const key = task.model ? `${task.model.providerID}/${task.model.modelID}` : task.agent
  const queue = queuesByKey.get(key) ?? []
  const retryInput: LaunchInput = {
    description: task.description,
    prompt: task.prompt,
    agent: task.agent,
    parentSessionID: task.parentSessionID,
    parentMessageID: task.parentMessageID,
    parentModel: task.parentModel,
    parentAgent: task.parentAgent,
    parentTools: task.parentTools,
    model: task.model,
    fallbackChain: task.fallbackChain,
    category: task.category,
    isUnstableAgent: task.isUnstableAgent,
  }

  if (previousSessionID) {
    await abortWithTimeout(client, previousSessionID).catch(() => {})
  }

  queue.push({ task, input: retryInput })
  queuesByKey.set(key, queue)
  processKey(key)
  return true
}
