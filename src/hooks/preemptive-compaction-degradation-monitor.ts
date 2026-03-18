import type { OhMyOpenCodeConfig } from "../config"
import { log } from "../shared/logger"
import { resolveNoTextTailFromSession } from "./preemptive-compaction-no-text-tail"
import { resolveCompactionModel } from "./shared/compaction-model-resolver"

const PREEMPTIVE_COMPACTION_TIMEOUT_MS = 120_000
const POST_COMPACTION_MONITOR_COUNT = 5
const POST_COMPACTION_NO_TEXT_THRESHOLD = 3

declare function setTimeout(handler: () => void, timeout?: number): unknown
declare function clearTimeout(timeoutID: unknown): void

interface CompactionTargetState {
  providerID: string
  modelID: string
}

interface ClientLike {
  session: {
    summarize: (input: {
      path: { id: string }
      body: { providerID: string; modelID: string }
      query: { directory: string }
    }) => Promise<unknown>
    messages: (input: {
      path: { id: string }
      query?: { directory: string }
    }) => Promise<unknown>
  }
  tui: {
    showToast: (input: {
      body: {
        title: string
        message: string
        variant: "warning"
        duration: number
      }
    }) => Promise<unknown>
  }
}

export interface AssistantCompactionMessageInfo {
  sessionID: string
  id?: string
}

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

export function createPostCompactionDegradationMonitor(args: {
  client: ClientLike
  directory: string
  pluginConfig: OhMyOpenCodeConfig
  tokenCache: Map<string, CompactionTargetState>
  compactionInProgress: Set<string>
}) {
  const { client, directory, pluginConfig, tokenCache, compactionInProgress } = args
  const postCompactionRemaining = new Map<string, number>()
  const postCompactionNoTextStreak = new Map<string, number>()
  const postCompactionRecoveryTriggered = new Set<string>()
  const postCompactionEpoch = new Map<string, number>()

  const clear = (sessionID: string): void => {
    postCompactionRemaining.delete(sessionID)
    postCompactionNoTextStreak.delete(sessionID)
    postCompactionRecoveryTriggered.delete(sessionID)
    postCompactionEpoch.delete(sessionID)
  }

  const onSessionCompacted = (sessionID: string): void => {
    const nextEpoch = (postCompactionEpoch.get(sessionID) ?? 0) + 1
    postCompactionEpoch.set(sessionID, nextEpoch)
    postCompactionRemaining.set(sessionID, POST_COMPACTION_MONITOR_COUNT)
    postCompactionNoTextStreak.set(sessionID, 0)
    postCompactionRecoveryTriggered.delete(sessionID)
  }

  const triggerRecovery = async (sessionID: string): Promise<void> => {
    if (postCompactionRecoveryTriggered.has(sessionID) || compactionInProgress.has(sessionID)) return

    const cached = tokenCache.get(sessionID)
    if (!cached?.modelID) {
      log("[preemptive-compaction] No-text tail detected but compaction model is unavailable", { sessionID })
      return
    }

    postCompactionRecoveryTriggered.add(sessionID)
    compactionInProgress.add(sessionID)
    const recoveryEpoch = postCompactionEpoch.get(sessionID) ?? 0

    try {
      const { providerID: targetProviderID, modelID: targetModelID } = resolveCompactionModel(
        pluginConfig,
        sessionID,
        cached.providerID,
        cached.modelID,
      )

      await client.tui
        .showToast({
          body: {
            title: "Session Degradation Detected",
            message: "Detected repeated no-text assistant responses after compaction. Retrying compaction recovery.",
            variant: "warning",
            duration: 5000,
          },
        })
        .catch(() => {})

      await withTimeout(
        client.session.summarize({
          path: { id: sessionID },
          body: { providerID: targetProviderID, modelID: targetModelID },
          query: { directory },
        }),
        PREEMPTIVE_COMPACTION_TIMEOUT_MS,
        `Compaction recovery summarize timed out after ${PREEMPTIVE_COMPACTION_TIMEOUT_MS}ms`,
      )

      log("[preemptive-compaction] Triggered recovery after post-compaction no-text tail", { sessionID })
    } catch (error) {
      log("[preemptive-compaction] Failed to recover post-compaction no-text tail", {
        sessionID,
        error: String(error),
      })
    } finally {
      compactionInProgress.delete(sessionID)
      if ((postCompactionEpoch.get(sessionID) ?? 0) === recoveryEpoch) {
        clear(sessionID)
      }
    }
  }

  const onAssistantMessageUpdated = async (info: AssistantCompactionMessageInfo): Promise<void> => {
    const remaining = postCompactionRemaining.get(info.sessionID)
    if (!remaining || remaining <= 0) return

    if (remaining === 1) {
      postCompactionRemaining.delete(info.sessionID)
    } else {
      postCompactionRemaining.set(info.sessionID, remaining - 1)
    }

    const isNoTextTail = await resolveNoTextTailFromSession({
      client,
      sessionID: info.sessionID,
      messageID: info.id,
      directory,
    })

    if (!isNoTextTail) {
      postCompactionNoTextStreak.set(info.sessionID, 0)
      return
    }

    const nextStreak = (postCompactionNoTextStreak.get(info.sessionID) ?? 0) + 1
    postCompactionNoTextStreak.set(info.sessionID, nextStreak)

    if (nextStreak >= POST_COMPACTION_NO_TEXT_THRESHOLD) {
      log("[preemptive-compaction] Detected post-compaction no-text tail pattern", {
        sessionID: info.sessionID,
        streak: nextStreak,
      })
      await triggerRecovery(info.sessionID)
    }
  }

  return {
    clear,
    onSessionCompacted,
    onAssistantMessageUpdated,
  }
}
