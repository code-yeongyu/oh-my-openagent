import { log } from "../shared/logger"
import type { OhMyOpenCodeConfig } from "../config"
import {
  resolveActualContextLimit,
  type ContextLimitModelCacheState,
} from "../shared/context-limit-resolver"

import { resolveCompactionModel } from "./shared/compaction-model-resolver"
const PREEMPTIVE_COMPACTION_TIMEOUT_MS = 120_000

const PREEMPTIVE_COMPACTION_THRESHOLD = 0.78

interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

interface CachedCompactionState {
  providerID: string
  modelID: string
  tokens: TokenInfo
}

async function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number,
  errorMessage: string,
): Promise<TValue> {
  let timeoutID: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(errorMessage))
    }, timeoutMs)
  })

  return await Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID)
    }
  })
}

type PluginInput = {
  client: {
    session: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: (...args: any[]) => any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      summarize: (...args: any[]) => any
    }
    tui: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      showToast: (...args: any[]) => any
    }
  }
  directory: string
}

export function createPreemptiveCompactionHook(
  ctx: PluginInput,
  pluginConfig: OhMyOpenCodeConfig,
  modelCacheState?: ContextLimitModelCacheState,
) {
  const compactionInProgress = new Set<string>()
  const compactedSessions = new Set<string>()
  const tokenCache = new Map<string, CachedCompactionState>()

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    _output: { title: string; output: string; metadata: unknown }
  ) => {
    const { sessionID } = input
    if (compactedSessions.has(sessionID) || compactionInProgress.has(sessionID)) return

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

    const lastTokens = cached.tokens
    const totalInputTokens = (lastTokens?.input ?? 0) + (lastTokens?.cache?.read ?? 0)
    const usageRatio = totalInputTokens / actualLimit

    if (usageRatio < PREEMPTIVE_COMPACTION_THRESHOLD) return

    const modelID = cached.modelID
    if (!modelID) return

    compactionInProgress.add(sessionID)

    try {
      const { providerID: targetProviderID, modelID: targetModelID } = resolveCompactionModel(
        pluginConfig,
        sessionID,
        cached.providerID,
        modelID
      )

      await withTimeout(
        ctx.client.session.summarize({
          path: { id: sessionID },
          body: { providerID: targetProviderID, modelID: targetModelID, auto: true } as never,
          query: { directory: ctx.directory },
        }),
        PREEMPTIVE_COMPACTION_TIMEOUT_MS,
        `Compaction summarize timed out after ${PREEMPTIVE_COMPACTION_TIMEOUT_MS}ms`,
      )

      compactedSessions.add(sessionID)
    } catch (error) {
      log("[preemptive-compaction] Compaction failed", { sessionID, error: String(error) })
    } finally {
      compactionInProgress.delete(sessionID)
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        compactionInProgress.delete(sessionInfo.id)
        compactedSessions.delete(sessionInfo.id)
        tokenCache.delete(sessionInfo.id)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as {
        role?: string
        sessionID?: string
        providerID?: string
        modelID?: string
        finish?: boolean
        tokens?: TokenInfo
      } | undefined

      if (!info || info.role !== "assistant" || !info.finish) return
      if (!info.sessionID || !info.providerID || !info.tokens) return

      tokenCache.set(info.sessionID, {
        providerID: info.providerID,
        modelID: info.modelID ?? "",
        tokens: info.tokens,
      })
      compactedSessions.delete(info.sessionID)
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
