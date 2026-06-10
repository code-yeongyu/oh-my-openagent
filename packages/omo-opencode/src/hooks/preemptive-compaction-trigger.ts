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
import type { PruningState } from "./anthropic-context-window-limit-recovery/pruning-types"
import type { DeduplicationConfig } from "./anthropic-context-window-limit-recovery/pruning-deduplication"
import { executeDeduplication } from "./anthropic-context-window-limit-recovery/pruning-deduplication"
import { truncateToolOutputsByCallId } from "./anthropic-context-window-limit-recovery/pruning-tool-output-truncation"

const PREEMPTIVE_COMPACTION_TIMEOUT_MS = 60_000
const PREEMPTIVE_COMPACTION_THRESHOLD = 0.78
const PROACTIVE_DEDUP_THRESHOLD = 0.40
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

async function runProactiveDedup(
  sessionID: string,
  pluginConfig: OhMyOpenCodeConfig,
  ctx: PreemptiveCompactionContext,
): Promise<void> {
  const pruningConfig = pluginConfig.experimental?.dynamic_context_pruning
  if (!pruningConfig?.enabled) return
  if (pruningConfig.strategies?.deduplication?.enabled === false) return

  const protectedTools = new Set(pruningConfig.protected_tools ?? [])
  const config: DeduplicationConfig = {
    enabled: true,
    protectedTools: pruningConfig.protected_tools ?? [],
  }

  const state: PruningState = {
    toolIdsToPrune: new Set<string>(),
    currentTurn: 0,
    fileOperations: new Map(),
    toolSignatures: new Map(),
    erroredTools: new Map(),
  }

  const prunedCount = await executeDeduplication(
    sessionID,
    state,
    config,
    protectedTools,
    ctx.client as Parameters<typeof executeDeduplication>[4],
  )

  if (prunedCount > 0) {
    await truncateToolOutputsByCallId(
      sessionID,
      state.toolIdsToPrune,
      ctx.client as Parameters<typeof truncateToolOutputsByCallId>[2],
    )
    log("[preemptive-compaction] proactive dedup applied", {
      sessionID,
      prunedCount,
    })
  }
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
  } = args

  if (compactedSessions.has(sessionID) || compactionInProgress.has(sessionID)) return

  const lastTime = lastCompactionTime.get(sessionID)
  if (lastTime && Date.now() - lastTime < PREEMPTIVE_COMPACTION_COOLDOWN_MS) return

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
  if (!cached.modelID) return

  if (usageRatio >= PROACTIVE_DEDUP_THRESHOLD) {
    await runProactiveDedup(sessionID, pluginConfig, ctx)
  }

  if (usageRatio < PREEMPTIVE_COMPACTION_THRESHOLD) return

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
        message: `Context window is above ${Math.round(PREEMPTIVE_COMPACTION_THRESHOLD * 100)}% and auto-compaction could not run. The session may grow large. Error: ${errorMessage}`,
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
