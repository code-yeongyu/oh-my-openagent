import { CompactionConfigSchema } from "../config/schema/compaction"
import type { OhMyOpenCodeConfig } from "../config"
import {
  resolveActualContextLimit,
  type ContextLimitModelCacheState,
} from "../shared/context-limit-resolver"
import { log } from "../shared/logger"

import { resolveCompactionModel } from "./shared/compaction-model-resolver"
import type {
  CachedCompactionState,
  PreemptiveCompactionContext,
} from "./preemptive-compaction-types"

const PREEMPTIVE_COMPACTION_TIMEOUT_MS = 60_000

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
  toolName?: string
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
    toolName,
  } = args

  const compactionConfig = CompactionConfigSchema.parse(pluginConfig.compaction ?? {})
  if (!compactionConfig.enabled) return

  if (compactedSessions.has(sessionID) || compactionInProgress.has(sessionID)) return

  const lastTime = lastCompactionTime.get(sessionID)
  if (lastTime && Date.now() - lastTime < compactionConfig.cooldown_ms) return

  if (toolName === "background_output") return

  const cached = tokenCache.get(sessionID)
  if (!cached) return

  const actualLimit = resolveActualContextLimit(
    cached.providerID,
    cached.modelID,
    modelCacheState,
  )

  if (actualLimit === null) {
    log("[preemptive-compaction] Skipping preemptive compaction: unknown context limit for model", {
      providerID: cached.providerID,
      modelID: cached.modelID,
    })
    return
  }

  const totalInputTokens = (cached.tokens.input ?? 0) + (cached.tokens.cache?.read ?? 0)
  const usageRatio = totalInputTokens / actualLimit
  if (usageRatio < compactionConfig.preemptive_threshold || !cached.modelID) return

  compactionInProgress.add(sessionID)
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
  } catch (error) {
    const errorMessage = String(error)
    log("[preemptive-compaction] Compaction failed", {
      sessionID,
      providerID: cached.providerID,
      modelID: cached.modelID,
      error: errorMessage,
    })
    ctx.client.tui.showToast({
      body: {
        title: "Preemptive compaction failed",
        message: `Context window is above ${Math.round(compactionConfig.preemptive_threshold * 100)}% and auto-compaction could not run. The session may grow large. Error: ${errorMessage}`,
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
