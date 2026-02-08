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

  return async (input): Promise<void> => {
    await hooks.autoUpdateChecker?.event?.(input)
    await hooks.claudeCodeHooks?.event?.(input)
    await hooks.backgroundNotificationHook?.event?.(input)
    await hooks.sessionNotification?.(input)
    await hooks.todoContinuationEnforcer?.handler?.(input)
    await hooks.unstableAgentBabysitter?.event?.(input)
    await hooks.contextWindowMonitor?.event?.(input)
    await hooks.directoryAgentsInjector?.event?.(input)
    await hooks.directoryReadmeInjector?.event?.(input)
    await hooks.rulesInjector?.event?.(input)
    await hooks.thinkMode?.event?.(input)
    await hooks.anthropicContextWindowLimitRecovery?.event?.(input)
    await hooks.agentUsageReminder?.event?.(input)
    await hooks.categorySkillReminder?.event?.(input)
    await hooks.interactiveBashSession?.event?.(input)
    await hooks.ralphLoop?.event?.(input)
    await hooks.stopContinuationGuard?.event?.(input)
    await hooks.compactionTodoPreserver?.event?.(input)
    await hooks.atlasHook?.handler?.(input)

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
