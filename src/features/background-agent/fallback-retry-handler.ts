import type { BackgroundTask, LaunchInput } from "./types"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient, QueueItem } from "./constants"
import { log, readConnectedProvidersCache, readProviderModelsCache } from "../../shared"
import {
  shouldRetryError,
  getNextFallback,
  hasMoreFallbacks,
  hasCrossProviderFallback,
  isProviderScopedStop,
  selectFallbackProvider,
} from "../../shared/model-error-classifier"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import { abortWithTimeout } from "./abort-with-timeout"
import { ensureCurrentAttempt, scheduleRetryAttempt } from "./attempt-lifecycle"

function canonicalizeModelID(modelID: string): string {
  return modelID.toLowerCase().replace(/\./g, "-")
}

export async function tryFallbackRetry(args: {
  task: BackgroundTask
  errorInfo: { name?: string; message?: string }
  source: string
  concurrencyManager: ConcurrencyManager
  client: OpencodeClient
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  queuesByKey: Map<string, QueueItem[]>
  processKey: (key: string) => void
  onRetrying?: (details: {
    task: BackgroundTask
    source: string
    previousSessionID?: string
    failedModel?: string
    failedError?: string
    nextModel: string
  }) => void
  /**
   * Same-model cross-provider escape (sticky-on-model semantics). When
   * set, the function bypasses the modelIntent="explicit" sticky guard
   * AND skips chain advancement. Instead it builds a synthetic single-
   * entry fallback containing the task's CURRENT modelID with
   * `crossProviderProviders` as the candidate provider list. The first
   * reachable entry in that list becomes the new providerID; the
   * modelID stays put. Used by manager.ts when a sticky task hits
   * `isProviderScopedStop` (insufficient balance / quota exceeded) so
   * the user's pinned model can continue on a still-solvent provider
   * instead of failing the work.
   */
  forceCrossProvider?: boolean
  crossProviderProviders?: string[]
}): Promise<boolean> {
  const { task, errorInfo, source, concurrencyManager, client, idleDeferralTimers, queuesByKey, processKey, onRetrying } = args
  // Sticky-model policy: when the user explicitly named a model
  // (CLI --model, /model command, or `agents.<name>.model` in their
  // config), the runtime must not advance the fallback chain to a
  // different model — this is what produced the silent
  // DeepSeek-V4-Pro -> Kimi-K2.6 swap mid-run.
  //
  // Returning false here does NOT immediately fail the task: the caller
  // (manager.ts handleSessionError around :1507-1535) checks whether the
  // OpenCode session is still alive. For the common case — transient
  // 5xx, rate limits, brief provider disconnects — the session survives
  // and the manager simply returns silently, letting OpenCode/the
  // provider retry the same model internally. Work continues on the
  // user's chosen model with no interruption and no swap. Only when the
  // session itself is genuinely dead (network gone, server crash) does
  // the task error out, which is identical to the auto-mode path after
  // a chain is exhausted.
  //
  // Auto-resolved models (category default, chain-derived) still permit
  // chain advancement as before.
  let selectedAttemptCount = task.attemptCount ?? 0
  let nextFallback: FallbackEntry | undefined
  let nextProviderID: string | undefined

  if (args.forceCrossProvider && args.crossProviderProviders && args.crossProviderProviders.length > 0 && task.model) {
    // Same-model cross-provider escape: sticky-on-model honored, only the
    // providerID changes. Pick the first connected alternate provider; if
    // it doesn't actually serve the model, the next session.error will
    // route through this same path and pick the next alternate. The escape
    // is bounded by `crossProviderProviders.length` so it can't loop
    // forever — exhaustion falls through to the structured fail path.
    const candidateProviderID = args.crossProviderProviders[0]
    nextFallback = {
      providers: args.crossProviderProviders,
      model: task.model.modelID,
      variant: task.model.variant,
    }
    nextProviderID = candidateProviderID
    log("[background-agent] Sticky cross-provider escape selected", {
      taskId: task.id,
      source,
      previousProvider: task.model.providerID,
      nextProvider: candidateProviderID,
      preservedModel: task.model.modelID,
    })
    // Note: NOT incrementing selectedAttemptCount; this is a provider swap,
    // not a chain advancement. The original chain (if any) is left intact
    // for any subsequent sticky failures.
  } else {
    if (task.modelIntent === "explicit") {
      log("[background-agent] Sticky-model: skipping chain fallback for explicit-intent task; session-alive handler will continue same-model retry if applicable", {
        taskId: task.id,
        source,
        model: task.model ? `${task.model.providerID}/${task.model.modelID}` : undefined,
        errorName: errorInfo.name,
      })
      return false
    }
    const fallbackChain = task.fallbackChain
    const baseRetry = shouldRetryError(errorInfo)
    // STOP-pattern errors (insufficient balance / quota exceeded / out of
    // credits) are non-retryable on the SAME provider, but the user's chain
    // may explicitly cross providers (e.g. github-copilot -> opencode-go).
    // Permit retry in that narrow case so a cross-provider chain isn't dead
    // wood the moment one provider's pool empties.
    const crossProviderEscape =
      !baseRetry &&
      isProviderScopedStop(errorInfo) &&
      !!fallbackChain &&
      hasCrossProviderFallback(fallbackChain, task.attemptCount ?? 0, task.model?.providerID)
    const canRetry =
      (baseRetry || crossProviderEscape) &&
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

    selectedAttemptCount = attemptCount
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
      const candidateProviderID = selectFallbackProvider(
        candidate.providers,
        task.model?.providerID,
      )
      const candidateModelID = transformModelForProvider(candidateProviderID, candidate.model)
      const isNoOpFallback =
        !!task.model &&
        candidateProviderID.toLowerCase() === task.model.providerID.toLowerCase() &&
        canonicalizeModelID(candidateModelID) === canonicalizeModelID(task.model.modelID)
      if (isNoOpFallback) {
        log("[background-agent] Skipping no-op fallback:", {
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
  }

  const providerID = nextProviderID ?? selectFallbackProvider(
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

  const idleTimer = idleDeferralTimers.get(task.id)
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleDeferralTimers.delete(task.id)
  }

  const previousSessionID = task.sessionId
  const previousModel = task.model

  const transformedModelId = transformModelForProvider(providerID, nextFallback.model)
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

  const key = task.model ? `${task.model.providerID}/${task.model.modelID}` : task.agent
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
    model: nextModel,
    // modelIntent must propagate across retries — without this carry-over
    // the sticky-on-explicit-model gate silently disengages after the first
    // retry, and a sticky team-mode follower starts walking the chain
    // freely on the second transient error.
    modelIntent: task.modelIntent,
    fallbackChain: task.fallbackChain,
    category: task.category,
    isUnstableAgent: task.isUnstableAgent,
  }

  if (previousSessionID) {
    await abortWithTimeout(client, previousSessionID).catch(() => {})
  }

  queue.push({ task, input: retryInput, attemptID: nextAttempt.attemptId })
  queuesByKey.set(key, queue)
  processKey(key)
  return true
}
