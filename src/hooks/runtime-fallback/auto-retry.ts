import type { HookDeps, RuntimeFallbackTimeout } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { normalizeAgentName, resolveAgentForSession } from "./agent-resolver"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { prepareFallback } from "./fallback-state"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { clearDelegatedChildSessionBootstrap } from "../../shared/delegated-child-session-bootstrap"
import { buildRetryModelPayload } from "./retry-model-payload"
import { getLastUserRetryPayload } from "./last-user-retry-parts"
import { extractSessionMessages } from "./session-messages"
import { resolveRegisteredAgentName } from "../../features/claude-code-session-state"
import {
  createInternalAgentTextPart,
  isSyntheticOrInternalTextPart,
} from "../../shared/internal-initiator-marker"
import {
  cancelQueuedInternalPrompts,
  dispatchInternalPrompt,
  isInternalPromptDispatchAccepted,
  releasePromptAsyncReservation,
} from "../shared/prompt-async-gate"
import { isAmbiguousPostDispatchPromptFailure } from "../../shared/prompt-failure-classifier"

const SESSION_TTL_MS = 30 * 60 * 1000

function normalizeRetryPartsForInternalDispatch(
  retryParts: Array<{ type: "text"; text: string }>,
): Array<{ type: "text"; text: string }> {
  return retryParts.map((part) => {
    if (isSyntheticOrInternalTextPart(part)) {
      return part
    }

    return createInternalAgentTextPart(part.text)
  })
}

declare function setTimeout(callback: () => void | Promise<void>, delay?: number): RuntimeFallbackTimeout
declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export function createAutoRetryHelpers(deps: HookDeps) {
  const {
    ctx,
    config,
    options,
    sessionStates,
    sessionLastAccess,
    sessionRetryInFlight,
    sessionAwaitingFallbackResult,
    sessionFallbackTimeouts,
    pluginConfig,
    sessionStatusRetryKeys,
  } = deps

  const abortSessionRequest = async (sessionID: string, source: string): Promise<void> => {
    // Sources we trigger ourselves to swap in a fallback model. Marking the
    // session lets handleSessionError tell our abort apart from a user stop
    // so it doesn't wipe attemptCount and re-enter the retry loop.
    if (
      source === "session.status.retry-signal" ||
      source === "message.updated.retry-signal" ||
      source === "session.timeout"
    ) {
      deps.internallyAbortedSessions.add(sessionID)
    }
    try {
      await ctx.client.session.abort({ path: { id: sessionID } })
      releasePromptAsyncReservation(sessionID, `runtime-fallback-abort:${source}`, {
        reservedBy: `runtime-fallback:${source}`,
        reservedByPrefix: "runtime-fallback:",
      })
      log(`[${HOOK_NAME}] Aborted in-flight session request (${source})`, { sessionID })
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to abort in-flight session request (${source})`, {
        sessionID,
        error: String(error),
      })
    }
  }

  const clearSessionFallbackTimeout = (sessionID: string) => {
    const timer = sessionFallbackTimeouts.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      sessionFallbackTimeouts.delete(sessionID)
    }
  }

  const scheduleSessionFallbackTimeout = (sessionID: string, resolvedAgent?: string) => {
    clearSessionFallbackTimeout(sessionID)

    const timeoutMs = options?.session_timeout_ms ?? config.timeout_seconds * 1000
    if (timeoutMs <= 0) return

    const timer = setTimeout(async () => {
      sessionFallbackTimeouts.delete(sessionID)

      const state = sessionStates.get(sessionID)
      if (!state) return

      if (sessionRetryInFlight.has(sessionID)) {
        log(`[${HOOK_NAME}] Overriding in-flight retry due to session timeout`, { sessionID })
      }

      await abortSessionRequest(sessionID, "session.timeout")
      sessionRetryInFlight.delete(sessionID)

      if (state.pendingFallbackModel) {
        state.pendingFallbackModel = undefined
      }
      state.pendingFallbackPromptMayHaveBeenAccepted = false

      const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)
      if (fallbackModels.length === 0) return

      log(`[${HOOK_NAME}] Session fallback timeout reached`, {
        sessionID,
        timeoutSeconds: config.timeout_seconds,
        currentModel: state.currentModel,
      })

      const result = prepareFallback(sessionID, state, fallbackModels, config)
      if (result.success && result.newModel) {
        await autoRetryWithFallback(sessionID, result.newModel, resolvedAgent, "session.timeout")
      }
    }, timeoutMs)

    sessionFallbackTimeouts.set(sessionID, timer)
  }

  const autoRetryWithFallback = async (
    sessionID: string,
    newModel: string,
    resolvedAgent: string | undefined,
    source: string,
  ): Promise<void> => {
    if (sessionRetryInFlight.has(sessionID)) {
      log(`[${HOOK_NAME}] Retry already in flight, skipping (${source})`, { sessionID })
      return
    }

    const agentSettings = resolvedAgent
      ? pluginConfig?.agents?.[resolvedAgent as keyof typeof pluginConfig.agents]
      : undefined
    const retryModelPayload = buildRetryModelPayload(newModel, agentSettings ? {
      variant: agentSettings.variant,
      reasoningEffort: agentSettings.reasoningEffort,
    } : undefined)
    if (!retryModelPayload) {
      log(`[${HOOK_NAME}] Invalid model format (missing provider prefix): ${newModel}`)
      const state = sessionStates.get(sessionID)
      if (state?.pendingFallbackModel) {
        state.pendingFallbackModel = undefined
      }
      if (state) {
        state.pendingFallbackPromptMayHaveBeenAccepted = false
      }
      return
    }

    const hadAwaitingFallbackResult = sessionAwaitingFallbackResult.has(sessionID)
    const previousPendingFallbackModel = sessionStates.get(sessionID)?.pendingFallbackModel
    const previousPendingFallbackPromptMayHaveBeenAccepted = sessionStates.get(sessionID)?.pendingFallbackPromptMayHaveBeenAccepted
    sessionRetryInFlight.add(sessionID)
    let retryDispatched = false
    let retryMayHaveBeenAccepted = false
    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      const retryPayload = getLastUserRetryPayload(messagesResp, sessionID)
      const retryParts = normalizeRetryPartsForInternalDispatch(retryPayload.retryParts)
      if (retryParts.length > 0) {
        log(`[${HOOK_NAME}] Auto-retrying with fallback model (${source})`, {
          sessionID,
          model: newModel,
        })

        const retryAgent = resolvedAgent ?? getSessionAgent(sessionID)
        const launchAgent = resolveRegisteredAgentName(retryAgent)
        if (!hadAwaitingFallbackResult) {
          sessionAwaitingFallbackResult.add(sessionID)
          scheduleSessionFallbackTimeout(sessionID, retryAgent)
        }

        const promptResult = await dispatchInternalPrompt({
          mode: "async",
          client: ctx.client,
          sessionID,
          source: `runtime-fallback:${source}`,
          settleMs: 0,
          queueBehavior: "enqueue",
          input: {
            path: { id: sessionID },
            body: {
              ...(launchAgent ? { agent: launchAgent } : {}),
              ...retryModelPayload,
              ...(retryPayload.system ? { system: retryPayload.system } : {}),
              ...(retryPayload.tools ? { tools: retryPayload.tools } : {}),
              parts: retryParts,
            },
            query: { directory: ctx.directory },
          },
        })
        if (promptResult.status === "failed") {
          if (isAmbiguousPostDispatchPromptFailure(promptResult)) {
            retryMayHaveBeenAccepted = true
            log(`[${HOOK_NAME}] Auto-retry prompt failed after dispatch may have been accepted (${source}); preserving fallback state`, {
              sessionID,
              error: String(promptResult.error),
            })
          }
          throw promptResult.error
        }
        if (!isInternalPromptDispatchAccepted(promptResult)) {
          log(`[${HOOK_NAME}] Auto-retry skipped by promptAsync gate (${source})`, {
            sessionID,
            status: promptResult.status,
          })
          return
        }
        sessionAwaitingFallbackResult.add(sessionID)
        if (hadAwaitingFallbackResult) {
          scheduleSessionFallbackTimeout(sessionID, retryAgent)
        }
        const state = sessionStates.get(sessionID)
        if (state) {
          state.pendingFallbackPromptMayHaveBeenAccepted = false
        }
        retryDispatched = true
      } else {
        log(`[${HOOK_NAME}] No user message found for auto-retry (${source})`, { sessionID })
      }
    } catch (retryError) {
      log(`[${HOOK_NAME}] Auto-retry failed (${source})`, { sessionID, error: String(retryError) })
    } finally {
      sessionRetryInFlight.delete(sessionID)
      if (retryMayHaveBeenAccepted) {
        const state = sessionStates.get(sessionID)
        if (state) {
          state.pendingFallbackPromptMayHaveBeenAccepted = true
        }
      }
      if (!retryDispatched && !retryMayHaveBeenAccepted) {
        if (hadAwaitingFallbackResult) {
          sessionAwaitingFallbackResult.add(sessionID)
        } else {
          sessionAwaitingFallbackResult.delete(sessionID)
          clearSessionFallbackTimeout(sessionID)
        }
        const state = sessionStates.get(sessionID)
        if (state) {
          if (hadAwaitingFallbackResult) {
            state.pendingFallbackModel = previousPendingFallbackModel
            state.pendingFallbackPromptMayHaveBeenAccepted = previousPendingFallbackPromptMayHaveBeenAccepted
          } else if (state.pendingFallbackModel) {
            state.pendingFallbackModel = undefined
            state.pendingFallbackPromptMayHaveBeenAccepted = false
          }
        }
      }

      if (!retryMayHaveBeenAccepted) {
        const cancelled = cancelQueuedInternalPrompts(sessionID, {
          sourcePrefix: "runtime-fallback:",
        })
        if (cancelled > 0) {
          log(`[${HOOK_NAME}] Cancelled stale queued runtime fallback prompts`, {
            sessionID,
            cancelled,
            source,
          })
        }
      }
    }
  }

  const resolveAgentForSessionFromContext = async (
    sessionID: string,
    eventAgent?: string,
  ): Promise<string | undefined> => {
    const resolved = resolveAgentForSession(sessionID, eventAgent)
    if (resolved) return resolved

    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      const msgs = extractSessionMessages(messagesResp)
      if (!msgs || msgs.length === 0) return undefined

      for (let i = msgs.length - 1; i >= 0; i--) {
        const info = msgs[i]?.info
        const infoAgent = typeof info?.agent === "string" ? info.agent : undefined
        const normalized = normalizeAgentName(infoAgent)
        if (normalized) {
          return normalized
        }
      }
    } catch {
      return undefined
    }

    return undefined
  }

  const cleanupStaleSessions = () => {
    const now = Date.now()
    let cleanedCount = 0
    for (const [sessionID, lastAccess] of sessionLastAccess.entries()) {
      if (now - lastAccess > SESSION_TTL_MS) {
        sessionStates.delete(sessionID)
        sessionLastAccess.delete(sessionID)
        sessionRetryInFlight.delete(sessionID)
        sessionAwaitingFallbackResult.delete(sessionID)
        clearSessionFallbackTimeout(sessionID)
        clearDelegatedChildSessionBootstrap(sessionID)
        SessionCategoryRegistry.remove(sessionID)
        sessionStatusRetryKeys.delete(sessionID)
        cleanedCount++
      }
    }
    if (cleanedCount > 0) {
      log(`[${HOOK_NAME}] Cleaned up ${cleanedCount} stale session states`)
    }
  }

  return {
    abortSessionRequest,
    clearSessionFallbackTimeout,
    scheduleSessionFallbackTimeout,
    autoRetryWithFallback,
    resolveAgentForSessionFromContext,
    cleanupStaleSessions,
  }
}

export type AutoRetryHelpers = ReturnType<typeof createAutoRetryHelpers>
