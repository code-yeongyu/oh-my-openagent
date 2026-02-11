import type { PluginInput } from "@opencode-ai/plugin"
import { getPlanProgress, readBoulderState } from "../../features/boulder-state"
import { subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./hook-name"
import { isAbortError } from "./is-abort-error"
import { injectBoulderContinuation } from "./boulder-continuation-injector"
import { getLastAgentFromSession } from "./session-last-agent"
import type { AtlasHookOptions, SessionState } from "./types"

const CONTINUATION_COOLDOWN_MS = 5000

export function createAtlasEventHandler(input: {
  ctx: PluginInput
  options?: AtlasHookOptions
  sessions: Map<string, SessionState>
  getState: (sessionID: string) => SessionState
}): (arg: { event: { type: string; properties?: unknown } }) => Promise<void> {
  const { ctx, options, sessions, getState } = input

  return async ({ event }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const state = getState(sessionID)
      const isAbort = isAbortError(props?.error)
      state.lastEventWasAbortError = isAbort

      log(`[${HOOK_NAME}] session.error`, { sessionID, isAbort })
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      log(`[${HOOK_NAME}] session.idle`, { sessionID })

      // Read boulder state FIRST to check if this session is part of an active boulder
      const boulderState = readBoulderState(ctx.directory)
      const isBoulderSession = boulderState?.session_ids?.includes(sessionID) ?? false

      const isBackgroundTaskSession = subagentSessions.has(sessionID)

      // Allow continuation only if: session is in boulder's session_ids OR is a background task
      if (!isBackgroundTaskSession && !isBoulderSession) {
        log(`[${HOOK_NAME}] Skipped: not boulder or background task session`, { sessionID })
        return
      }

      const state = getState(sessionID)

      if (state.lastEventWasAbortError) {
        state.lastEventWasAbortError = false
        log(`[${HOOK_NAME}] Skipped: abort error immediately before idle`, { sessionID })
        return
      }

      if (state.promptFailureCount >= 2) {
        log(`[${HOOK_NAME}] Skipped: continuation disabled after repeated prompt failures`, {
          sessionID,
          promptFailureCount: state.promptFailureCount,
        })
        return
      }

      const backgroundManager = options?.backgroundManager
      const hasRunningBgTasks = backgroundManager
        ? backgroundManager.getTasksByParentSession(sessionID).some((t: { status: string }) => t.status === "running")
        : false

      if (hasRunningBgTasks) {
        log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
        return
      }

      if (!boulderState) {
        log(`[${HOOK_NAME}] No active boulder`, { sessionID })
        return
      }

      if (options?.isContinuationStopped?.(sessionID)) {
        log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID })
        return
      }

      const lastAgent = getLastAgentFromSession(sessionID)
      const requiredAgent = (boulderState.agent ?? "atlas").toLowerCase()
      const lastAgentMatchesRequired = lastAgent === requiredAgent
      const boulderAgentWasNotExplicitlySet = boulderState.agent === undefined
      const boulderAgentDefaultsToAtlas = requiredAgent === "atlas"
      const lastAgentIsSisyphus = lastAgent === "sisyphus"
      const allowSisyphusWhenDefaultAtlas = boulderAgentWasNotExplicitlySet && boulderAgentDefaultsToAtlas && lastAgentIsSisyphus
      const agentMatches = lastAgentMatchesRequired || allowSisyphusWhenDefaultAtlas
      if (!agentMatches) {
        log(`[${HOOK_NAME}] Skipped: last agent does not match boulder agent`, {
          sessionID,
          lastAgent: lastAgent ?? "unknown",
          requiredAgent,
          boulderAgentExplicitlySet: boulderState.agent !== undefined,
        })
        return
      }

      const progress = getPlanProgress(boulderState.active_plan)
      if (progress.isComplete) {
        log(`[${HOOK_NAME}] Boulder complete`, { sessionID, plan: boulderState.plan_name })
        return
      }

      const now = Date.now()
      if (state.lastContinuationInjectedAt && now - state.lastContinuationInjectedAt < CONTINUATION_COOLDOWN_MS) {
        log(`[${HOOK_NAME}] Skipped: continuation cooldown active`, {
          sessionID,
          cooldownRemaining: CONTINUATION_COOLDOWN_MS - (now - state.lastContinuationInjectedAt),
        })
        return
      }

      state.lastContinuationInjectedAt = now
      const remaining = progress.total - progress.completed
      try {
        await injectBoulderContinuation({
          ctx,
          sessionID,
          planName: boulderState.plan_name,
          remaining,
          total: progress.total,
          agent: boulderState.agent,
          backgroundManager,
          sessionState: state,
        })
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to inject boulder continuation`, { sessionID, error: err })
        state.promptFailureCount++
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      if (!sessionID) return

      const state = sessions.get(sessionID)
      if (state) {
        state.lastEventWasAbortError = false
      }
      return
    }

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (sessionID && role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) {
          state.lastEventWasAbortError = false
        }
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        const state = sessions.get(sessionID)
        if (state) {
          state.lastEventWasAbortError = false
        }
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        sessions.delete(sessionInfo.id)
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
      }
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ?? (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        sessions.delete(sessionID)
        log(`[${HOOK_NAME}] Session compacted: cleaned up`, { sessionID })
      }
    }
  }
}
