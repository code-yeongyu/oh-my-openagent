import type { BackgroundTask, LaunchInput } from "./types"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient, QueueItem } from "./constants"
import { log, readConnectedProvidersCache, readProviderModelsCache } from "../../shared"
import {
  shouldRetryError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProvider,
} from "../../shared/model-error-classifier"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"

export function tryFallbackRetry(args: {
  task: BackgroundTask
  errorInfo: { name?: string; message?: string }
  source: string
  concurrencyManager: ConcurrencyManager
  client: OpencodeClient
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  queuesByKey: Map<string, QueueItem[]>
  processKey: (key: string) => void
}): boolean {
  const { task, errorInfo, source, concurrencyManager, client, idleDeferralTimers, queuesByKey, processKey } = args
  const fallbackChain = task.fallbackChain
  const canRetry =
    shouldRetryError(errorInfo) &&
    fallbackChain &&
    fallbackChain.length > 0 &&
    hasMoreFallbacks(fallbackChain, task.attemptCount ?? 0)

  if (!canRetry) return false

  const attemptCount = task.attemptCount ?? 0
  const providerModelsCache = readProviderModelsCache()
  const connectedProviders = providerModelsCache?.connected ?? readConnectedProvidersCache()
  const connectedSet = connectedProviders ? new Set(connectedProviders.map(p => p.toLowerCase())) : null

  const isReachable = (entry: FallbackEntry): boolean => {
    if (!connectedSet) return true
    return entry.providers.some((p) => connectedSet.has(p.toLowerCase()))
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

  const providerID = selectFallbackProvider(
    nextFallback.providers,
    task.model?.providerID,
  )

  log("[background-agent] Retryable error, attempting fallback:", {
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

  if (task.sessionID) {
    client.session.abort({ path: { id: task.sessionID } }).catch(() => {})
  }

  const idleTimer = idleDeferralTimers.get(task.id)
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleDeferralTimers.delete(task.id)
  }

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
  queue.push({ task, input: retryInput })
  queuesByKey.set(key, queue)
  processKey(key)
  return true
}
