import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext } from "./types"

import {
  clearSessionAgent,
  getMainSessionID,
  setMainSession,
  updateSessionAgent,
} from "../features/claude-code-session-state"
import { resetMessageCursor } from "../shared"
import { lspManager } from "../tools"

import type { CreatedHooks } from "../create-hooks"
import type { Managers } from "../create-managers"
import { normalizeSessionStatusToIdle } from "./session-status-normalizer"
import { pruneRecentSyntheticIdles } from "./recent-synthetic-idles"

type FirstMessageVariantGate = {
  markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void
  clear: (sessionID: string) => void
}

export function createEventHandler(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  firstMessageVariantGate: FirstMessageVariantGate
  managers: Managers
  hooks: CreatedHooks
}): (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void> {
  const { ctx, firstMessageVariantGate, managers, hooks } = args

  const dispatchToHooks = async (input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> => {
    await Promise.resolve(hooks.autoUpdateChecker?.event?.(input))
    await Promise.resolve(hooks.claudeCodeHooks?.event?.(input))
    await Promise.resolve(hooks.backgroundNotificationHook?.event?.(input))
    await Promise.resolve(hooks.sessionNotification?.(input))
    await Promise.resolve(hooks.todoContinuationEnforcer?.handler?.(input))
    await Promise.resolve(hooks.unstableAgentBabysitter?.event?.(input))
    await Promise.resolve(hooks.contextWindowMonitor?.event?.(input))
    await Promise.resolve(hooks.directoryAgentsInjector?.event?.(input))
    await Promise.resolve(hooks.directoryReadmeInjector?.event?.(input))
    await Promise.resolve(hooks.rulesInjector?.event?.(input))
    await Promise.resolve(hooks.thinkMode?.event?.(input))
    await Promise.resolve(hooks.anthropicContextWindowLimitRecovery?.event?.(input))
    await Promise.resolve(hooks.agentUsageReminder?.event?.(input))
    await Promise.resolve(hooks.categorySkillReminder?.event?.(input))
    await Promise.resolve(hooks.interactiveBashSession?.event?.(input))
    await Promise.resolve(hooks.ralphLoop?.event?.(input))
    await Promise.resolve(hooks.stopContinuationGuard?.event?.(input))
    await Promise.resolve(hooks.compactionTodoPreserver?.event?.(input))
    await Promise.resolve(hooks.atlasHook?.handler?.(input))
  }

  const recentSyntheticIdles = new Map<string, number>()
  const recentRealIdles = new Map<string, number>()
  const DEDUP_WINDOW_MS = 500

  return async (input): Promise<void> => {
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: Date.now(),
      dedupWindowMs: DEDUP_WINDOW_MS,
    })

    if (input.event.type === "session.idle") {
      const sessionID = (input.event.properties as Record<string, unknown> | undefined)?.sessionID as string | undefined
      if (sessionID) {
        const emittedAt = recentSyntheticIdles.get(sessionID)
        if (emittedAt && Date.now() - emittedAt < DEDUP_WINDOW_MS) {
          recentSyntheticIdles.delete(sessionID)
          return
        }
        recentRealIdles.set(sessionID, Date.now())
      }
    }

    await dispatchToHooks(input)

    const syntheticIdle = normalizeSessionStatusToIdle(input)
    if (syntheticIdle) {
      const sessionID = (syntheticIdle.event.properties as Record<string, unknown>)?.sessionID as string
      const emittedAt = recentRealIdles.get(sessionID)
      if (emittedAt && Date.now() - emittedAt < DEDUP_WINDOW_MS) {
        recentRealIdles.delete(sessionID)
        return
      }
      recentSyntheticIdles.set(sessionID, Date.now())
      await dispatchToHooks(syntheticIdle)
    }

    const { event } = input
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.created") {
      const sessionInfo = props?.info as
        | { id?: string; title?: string; parentID?: string }
        | undefined

      if (!sessionInfo?.parentID) {
        setMainSession(sessionInfo?.id)
      }

      firstMessageVariantGate.markSessionCreated(sessionInfo)

      await managers.tmuxSessionManager.onSessionCreated(
        event as {
          type: string
          properties?: {
            info?: { id?: string; parentID?: string; title?: string }
          }
        },
      )
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id === getMainSessionID()) {
        setMainSession(undefined)
      }

      if (sessionInfo?.id) {
        clearSessionAgent(sessionInfo.id)
        resetMessageCursor(sessionInfo.id)
        firstMessageVariantGate.clear(sessionInfo.id)
        await managers.skillMcpManager.disconnectSession(sessionInfo.id)
        await lspManager.cleanupTempDirectoryClients()
        await managers.tmuxSessionManager.onSessionDeleted({
          sessionID: sessionInfo.id,
        })
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const agent = info?.agent as string | undefined
      const role = info?.role as string | undefined
      if (sessionID && agent && role === "user") {
        updateSessionAgent(sessionID, agent)
      }
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      const error = props?.error

      if (hooks.sessionRecovery?.isRecoverableError(error)) {
        const messageInfo = {
          id: props?.messageID as string | undefined,
          role: "assistant" as const,
          sessionID,
          error,
        }
        const recovered = await hooks.sessionRecovery.handleSessionRecovery(messageInfo)

        if (
          recovered &&
          sessionID &&
          sessionID === getMainSessionID() &&
          !hooks.stopContinuationGuard?.isStopped(sessionID)
        ) {
          await ctx.client.session
            .prompt({
              path: { id: sessionID },
              body: { parts: [{ type: "text", text: "continue" }] },
              query: { directory: ctx.directory },
            })
            .catch(() => {})
        }
      }
    }
  }
}
