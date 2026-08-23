import type { OhMyOpenCodeConfig } from "../config"
import {
  resolveActualContextLimit,
  resolveContextBudgetPolicy,
  type ContextLimitModelCacheState,
} from "@oh-my-opencode/model-core"
import { log } from "../shared/logger"

import { resolveCompactionModel } from "./shared/compaction-model-resolver"
import type {
  CachedCompactionState,
  PreemptiveCompactionContext,
  SessionCompactionLifecycle,
} from "./preemptive-compaction-types"

const PREEMPTIVE_COMPACTION_TIMEOUT_MS = 60_000
const PREEMPTIVE_COMPACTION_COOLDOWN_MS = 60_000

declare function setTimeout(handler: () => void, timeout?: number): unknown
declare function clearTimeout(timeoutID: unknown): void

async function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number,
  errorMessage: string,
): Promise<TValue> {
  let timeoutID: unknown

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(errorMessage))
    }, timeoutMs)
  })

  return await Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutID)
  })
}

export async function runPreemptiveCompactionIfNeeded(args: {
  ctx: PreemptiveCompactionContext
  pluginConfig: OhMyOpenCodeConfig
  modelCacheState?: ContextLimitModelCacheState
  sessionID: string
  tokenCache: Map<string, CachedCompactionState>
  compactionInProgress: Set<string>
  compactedSessions: Set<string>
  lastCompactionTime: Map<string, number>
  lifecycleState?: Map<string, SessionCompactionLifecycle>
}): Promise<void> {
  const {
    ctx,
    pluginConfig,
    modelCacheState,
    sessionID,
    tokenCache,
    compactionInProgress,
    compactedSessions,
    lastCompactionTime,
    lifecycleState,
  } = args

  let lifecycle = lifecycleState?.get(sessionID)
  if (!lifecycle && lifecycleState) {
    lifecycle = { status: "idle", generation: 0 }
    lifecycleState.set(sessionID, lifecycle)
  }

  // Idempotency: skip if already compacted/applied or in progress
  if (
    compactedSessions.has(sessionID) ||
    compactionInProgress.has(sessionID) ||
    lifecycle?.status === "applied"
  ) {
    return
  }

  const lastTime = lastCompactionTime.get(sessionID)
  if (lastTime && Date.now() - lastTime < PREEMPTIVE_COMPACTION_COOLDOWN_MS) return

  const cached = tokenCache.get(sessionID)
  if (!cached) return

  const physicalLimit = resolveActualContextLimit(
    cached.providerID,
    cached.modelID,
    modelCacheState,
  )

  if (physicalLimit === null) {
    log("[preemptive-compaction] Skipping preemptive compaction: unknown context limit for model", {
      providerID: cached.providerID,
      modelID: cached.modelID,
    })
    return
  }

  // Resolve ContextBudgetPolicy: separates physicalContextWindow and maxActiveContextTokens
  const contextBudgetConfig = pluginConfig?.experimental?.context_budget

  const policy = resolveContextBudgetPolicy({
    providerID: cached.providerID,
    modelID: cached.modelID,
    physicalContextWindow: physicalLimit,
    config: contextBudgetConfig,
  })

  const totalInputTokens = (cached.tokens.input ?? 0) + (cached.tokens.cache?.read ?? 0)
  const usageRatio = totalInputTokens / policy.maxActiveContextTokens

  const triggerThreshold = policy.warmupFraction
  if (usageRatio < triggerThreshold || !cached.modelID) return

  compactionInProgress.add(sessionID)
  if (lifecycle) {
    lifecycle.status = "requested"
    lifecycle.requestedAt = Date.now()
  }
  lastCompactionTime.set(sessionID, Date.now())

  try {
    const { providerID: targetProviderID, modelID: targetModelID } = resolveCompactionModel(
      pluginConfig,
      sessionID,
      cached.providerID,
      cached.modelID,
    )

    await withTimeout(
      ctx.client.session.summarize({
        path: { id: sessionID },
        body: { providerID: targetProviderID, modelID: targetModelID, auto: true },
        query: { directory: ctx.directory },
      }),
      PREEMPTIVE_COMPACTION_TIMEOUT_MS,
      `Compaction summarize timed out after ${PREEMPTIVE_COMPACTION_TIMEOUT_MS}ms`,
    )

    compactedSessions.add(sessionID)
    if (lifecycle) {
      lifecycle.status = "applied"
      lifecycle.generation++
    }
  } catch (error) {
    const errorMessage = String(error)
    log("[preemptive-compaction] Compaction failed", {
      sessionID,
      providerID: cached.providerID,
      modelID: cached.modelID,
      error: errorMessage,
    })
    if (lifecycle) {
      lifecycle.status = "idle"
    }
    ctx.client.tui.showToast({
      body: {
        title: "Preemptive compaction failed",
        message: `Context window is above ${Math.round(triggerThreshold * 100)}% of active budget (${policy.maxActiveContextTokens}) and auto-compaction could not run. The session may grow large. Error: ${errorMessage}`,
        variant: "warning",
        duration: 10000,
      },
    }).catch((toastError: unknown) => {
      const toastErrorMessage = String(toastError)
      log("[preemptive-compaction] Failed to show toast", {
        sessionID,
        toastError: toastErrorMessage,
      })
      if (toastError instanceof Error) return
    })
    if (error instanceof Error) return
  } finally {
    compactionInProgress.delete(sessionID)
  }
}
