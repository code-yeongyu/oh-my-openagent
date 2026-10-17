import type { OhMyOpenCodeConfig } from "../config"
import {
  resolveActualContextLimit,
  type ContextLimitModelCacheState,
} from "../shared/context-limit-resolver"
import { log } from "../shared/logger"

import { resolveCompactionModelDecision } from "./shared/compaction-model-resolver"
import type {
  CachedCompactionState,
  PreemptiveCompactionContext,
  SummarizeAttempt,
} from "./preemptive-compaction-types"

const PREEMPTIVE_COMPACTION_TIMEOUT_MS = 60_000
const PREEMPTIVE_COMPACTION_THRESHOLD = 0.78
const PREEMPTIVE_COMPACTION_COOLDOWN_MS = 60_000
// A summarize whose provider stream never settles would otherwise keep the admission
// guard for the session forever and silently disable preemptive compaction until the
// plugin restarts. Release a guard that has outlived this ceiling at the next
// admission attempt, so a hung provider stream can never block the session for good.
// The normal cooldown still prevents a re-fire storm.
const PREEMPTIVE_COMPACTION_STALL_RELEASE_MS = 600_000
let summarizeAttemptCounter = 0

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
  summarizeStartedAt: Map<string, SummarizeAttempt>
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
    summarizeStartedAt,
  } = args

  const previousAttempt = summarizeStartedAt.get(sessionID)
  if (
    previousAttempt &&
    Date.now() - previousAttempt.startedAt >= PREEMPTIVE_COMPACTION_STALL_RELEASE_MS
  ) {
    log("[preemptive-compaction] releasing a stalled summarize guard", {
      sessionID,
      pendingMs: Date.now() - previousAttempt.startedAt,
      releaseAfterMs: PREEMPTIVE_COMPACTION_STALL_RELEASE_MS,
    })
    summarizeStartedAt.delete(sessionID)
    compactionInProgress.delete(sessionID)
  }

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
  if (usageRatio < PREEMPTIVE_COMPACTION_THRESHOLD || !cached.modelID) return

  summarizeAttemptCounter += 1
  const attempt: SummarizeAttempt = {
    startedAt: Date.now(),
    attemptID: summarizeAttemptCounter,
  }
  compactionInProgress.add(sessionID)
  summarizeStartedAt.set(sessionID, attempt)
  lastCompactionTime.set(sessionID, Date.now())
  let targetLabel = `${cached.providerID}/${cached.modelID}`

  try {
    const decision = resolveCompactionModelDecision(
      pluginConfig,
      sessionID,
      cached.providerID,
      cached.modelID,
      cached.agent,
    )
    targetLabel = `${decision.providerID}/${decision.modelID}`

    log("[preemptive-compaction] summarize model resolved", {
      sessionID,
      source: decision.source,
      reason: decision.reason,
      agentName: decision.agentName,
      agentConfigKey: decision.agentConfigKey,
      pinnedModel: decision.pinnedModel,
      target: targetLabel,
      sessionModel: `${cached.providerID}/${cached.modelID}`,
      usageRatio: Number(usageRatio.toFixed(4)),
    })

    const summarizePromise = ctx.client.session.summarize({
      path: { id: sessionID },
      body: { providerID: decision.providerID, modelID: decision.modelID, auto: true },
      query: { directory: ctx.directory },
    })

    const releaseInProgress = () => {
      // A superseded attempt must not clear the guard a newer attempt owns.
      if (summarizeStartedAt.get(sessionID)?.attemptID !== attempt.attemptID) return
      compactionInProgress.delete(sessionID)
      summarizeStartedAt.delete(sessionID)
    }
    void summarizePromise.then(releaseInProgress, releaseInProgress)

    await withTimeout(
      summarizePromise,
      PREEMPTIVE_COMPACTION_TIMEOUT_MS,
      `Compaction summarize timed out after ${PREEMPTIVE_COMPACTION_TIMEOUT_MS}ms`,
    )

    compactedSessions.add(sessionID)
  } catch (error) {
    const errorMessage = String(error)
    log("[preemptive-compaction] Compaction failed", {
      sessionID,
      target: targetLabel,
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
  }
}
