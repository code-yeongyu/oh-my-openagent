import type { MatrixxConfig } from "../config"
import type { ContextLimitModelCacheState } from "../shared/context-limit-resolver"
import { updateTokenCache, clearTokenCache } from "../shared/token-cache"
import { runPreemptiveCompactionIfNeeded } from "./preemptive-compaction-trigger"
import {
  createPostCompactionDegradationMonitor,
  type AssistantCompactionMessageInfo,
} from "./preemptive-compaction-degradation-monitor"
import type {
  CachedCompactionState,
  PreemptiveCompactionContext,
  TokenInfo,
} from "./preemptive-compaction-types"

type PluginInput = PreemptiveCompactionContext

export function createPreemptiveCompactionHook(
  ctx: PluginInput,
  pluginConfig: MatrixxConfig = {},
  modelCacheState?: ContextLimitModelCacheState,
) {
  const compactionInProgress = new Set<string>()
  const compactedSessions = new Set<string>()
  const tokenCache = new Map<string, CachedCompactionState>()
  const lastCompactionTime = new Map<string, number>()

  const degradationMonitor = createPostCompactionDegradationMonitor({
    client: ctx.client,
    directory: ctx.directory,
    pluginConfig,
    tokenCache,
    compactionInProgress,
  })

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    _output: { title: string; output: string; metadata: unknown },
  ) => {
    const { sessionID } = input
    const wasCompacted = compactedSessions.has(sessionID)

    await runPreemptiveCompactionIfNeeded({
      ctx,
      pluginConfig,
      modelCacheState,
      sessionID,
      tokenCache,
      compactionInProgress,
      compactedSessions,
      lastCompactionTime,
    })

    if (!wasCompacted && compactedSessions.has(sessionID)) {
      degradationMonitor.onSessionCompacted(sessionID)
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        const id = sessionInfo.id
        compactionInProgress.delete(id)
        compactedSessions.delete(id)
        tokenCache.delete(id)
        lastCompactionTime.delete(id)
        degradationMonitor.clear(id)
        clearTokenCache(id)
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
        id?: string
      } | undefined

      if (!info || info.role !== "assistant" || !info.finish) return
      if (!info.sessionID || !info.providerID || !info.tokens) return

      tokenCache.set(info.sessionID, {
        providerID: info.providerID,
        modelID: info.modelID ?? "",
        tokens: info.tokens,
      })

      updateTokenCache(info.sessionID, {
        providerID: info.providerID,
        modelID: info.modelID,
        tokens: info.tokens,
      })

      const messageInfo: AssistantCompactionMessageInfo = {
        sessionID: info.sessionID,
        id: info.id,
      }
      await degradationMonitor.onAssistantMessageUpdated(messageInfo)
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
