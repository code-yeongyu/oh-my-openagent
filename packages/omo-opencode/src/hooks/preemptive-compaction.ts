import { CompactionConfigSchema } from "../config/schema/compaction"
import type { OhMyOpenCodeConfig } from "../config"
import { isCompactionAgent } from "../shared/compaction-marker"
import {
  resolveActualContextLimit,
  type ContextLimitModelCacheState,
} from "../shared/context-limit-resolver"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../shared/event-session-id"

import { createPostCompactionDegradationMonitor } from "./preemptive-compaction-degradation-monitor"
import { runPreemptiveCompactionIfNeeded } from "./preemptive-compaction-trigger"
import type {
  CachedCompactionState,
  PreemptiveCompactionContext,
  TokenInfo,
} from "./preemptive-compaction-types"

const REARM_MARGIN = 0.15

export function createPreemptiveCompactionHook(
  ctx: PreemptiveCompactionContext,
  pluginConfig: OhMyOpenCodeConfig,
  modelCacheState?: ContextLimitModelCacheState,
) {
  const compactionInProgress = new Set<string>()
  const compactedSessions = new Set<string>()
  const lastCompactionTime = new Map<string, number>()
  const tokenCache = new Map<string, CachedCompactionState>()

  const postCompactionMonitor = createPostCompactionDegradationMonitor({
    client: ctx.client,
    directory: ctx.directory,
    pluginConfig,
    tokenCache,
    compactionInProgress,
  })

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    _output: { title: string; output: string; metadata: unknown }
  ) => {
    await runPreemptiveCompactionIfNeeded({
      ctx,
      pluginConfig,
      modelCacheState,
      sessionID: input.sessionID,
      tokenCache,
      compactionInProgress,
      compactedSessions,
      lastCompactionTime,
      toolName: input.tool,
    })
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionID = resolveSessionEventID(props)
      if (sessionID) {
        compactionInProgress.delete(sessionID)
        compactedSessions.delete(sessionID)
        lastCompactionTime.delete(sessionID)
        tokenCache.delete(sessionID)
        postCompactionMonitor.clear(sessionID)
      }
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = resolveSessionEventID(props)
      if (sessionID) {
        postCompactionMonitor.onSessionCompacted(sessionID)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as {
        id?: string
        agent?: unknown
        role?: string
        sessionID?: string
        providerID?: string
        modelID?: string
        finish?: unknown
        tokens?: TokenInfo
        parts?: unknown
      } | undefined

      const sessionID = resolveMessageEventSessionID(props)
      const finish = info?.finish
      if (!info || info.role !== "assistant" || !finish || !sessionID) return
      if (isCompactionAgent(info.agent)) return

      if (info.providerID && info.tokens) {
        tokenCache.set(sessionID, {
          providerID: info.providerID,
          modelID: info.modelID ?? "",
          tokens: info.tokens,
        })
      }

      // Re-arm a previously compacted session ONLY when its usage ratio has
      // genuinely dropped below (threshold - REARM_MARGIN). Clearing the guard
      // on every assistant message would let the very next message re-arm and
      // immediately re-compact while context is still near the limit.
      if (compactedSessions.has(sessionID) && info.providerID && info.tokens) {
        const compactionConfig = CompactionConfigSchema.parse(pluginConfig.compaction ?? {})
        const threshold = compactionConfig.preemptive_threshold
        const totalInputTokens = (info.tokens.input ?? 0) + (info.tokens.cache?.read ?? 0)
        const actualLimit = resolveActualContextLimit(
          info.providerID,
          info.modelID ?? "",
          modelCacheState,
        )
        if (actualLimit !== null) {
          const ratio = totalInputTokens / actualLimit
          if (ratio < threshold - REARM_MARGIN) {
            compactedSessions.delete(sessionID)
          }
        }
      }

      await postCompactionMonitor.onAssistantMessageUpdated({
        sessionID,
        id: info.id,
        parts: info.parts,
      })
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
