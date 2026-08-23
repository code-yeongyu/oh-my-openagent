import type { OhMyOpenCodeConfig } from "../config"
import { isCompactionAgent } from "../shared/compaction-marker"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../shared/event-session-id"
import type { ContextLimitModelCacheState } from "@oh-my-opencode/model-core"

import { createPostCompactionDegradationMonitor } from "./preemptive-compaction-degradation-monitor"
import { runPreemptiveCompactionIfNeeded } from "./preemptive-compaction-trigger"
import type {
  CachedCompactionState,
  PreemptiveCompactionContext,
  SessionCompactionLifecycle,
  TokenInfo,
} from "./preemptive-compaction-types"

export function createPreemptiveCompactionHook(
  ctx: PreemptiveCompactionContext,
  pluginConfig: OhMyOpenCodeConfig,
  modelCacheState?: ContextLimitModelCacheState,
) {
  const compactionInProgress = new Set<string>()
  const compactedSessions = new Set<string>()
  const lastCompactionTime = new Map<string, number>()
  const tokenCache = new Map<string, CachedCompactionState>()
  const lifecycleState = new Map<string, SessionCompactionLifecycle>()

  const postCompactionMonitor = createPostCompactionDegradationMonitor({
    client: ctx.client,
    directory: ctx.directory,
    pluginConfig,
    tokenCache,
    compactionInProgress,
  })

  const checkCompaction = async (sessionID: string) => {
    await runPreemptiveCompactionIfNeeded({
      ctx,
      pluginConfig,
      modelCacheState,
      sessionID,
      tokenCache,
      compactionInProgress,
      compactedSessions,
      lastCompactionTime,
      lifecycleState,
    })
  }

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    _output: { title: string; output: string; metadata: unknown }
  ) => {
    await checkCompaction(input.sessionID)
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
        lifecycleState.delete(sessionID)
        postCompactionMonitor.clear(sessionID)
      }
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = resolveSessionEventID(props)
      if (sessionID) {
        const lifecycle = lifecycleState.get(sessionID)
        if (lifecycle) {
          lifecycle.status = "applied"
          lifecycle.generation++
        }
        // Invalidate stale token cache on completed compaction event!
        tokenCache.delete(sessionID)
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
        const lifecycle = lifecycleState.get(sessionID)
        if (lifecycle && lifecycle.status === "applied") {
          lifecycle.status = "idle"
        }
      }
      compactedSessions.delete(sessionID)

      await postCompactionMonitor.onAssistantMessageUpdated({
        sessionID,
        id: info.id,
        parts: info.parts,
      })

      // Also evaluate at message.updated turn boundary (idempotent with lifecycle guard)
      await checkCompaction(sessionID)
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
