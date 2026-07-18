import type { AutoRetryDispatchOutcome, HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { getSessionAgent, resolveRegisteredAgentName } from "../../features/claude-code-session-state"
import { buildRetryModelPayload } from "./retry-model-payload"
import { getLastUserRetryPayload } from "./last-user-retry-parts"
import { createInternalAgentContinuationTextPart } from "../../shared/internal-initiator-marker"
import {
  dispatchInternalPrompt,
  isInternalPromptDispatchAccepted,
  type InternalPromptDispatchResult,
} from "../shared/prompt-async-gate"
import { isAmbiguousPostDispatchPromptFailure } from "../../shared/prompt-failure-classifier"
import { resolveOriginalUserRetryMetadata } from "./auto-retry-metadata"

export function createAutoRetryDispatcher(
  deps: HookDeps,
  scheduleSessionFallbackTimeout: (sessionID: string, resolvedAgent?: string) => void,
  clearSessionFallbackTimeout: (sessionID: string) => void,
) {
  const {
    config,
    ctx,
    sessionStates,
    sessionRetryInFlight,
    sessionAwaitingFallbackResult,
    internallyAbortedSessions,
    pluginConfig,
  } = deps

  return async (
    sessionID: string,
    newModel: string,
    resolvedAgent: string | undefined,
    source: string,
  ): Promise<AutoRetryDispatchOutcome> => {
    if (sessionRetryInFlight.has(sessionID)) {
      log(`[${HOOK_NAME}] Retry already in flight, skipping (${source})`, { sessionID })
      return { accepted: false, status: "blocked", reason: "retry already in flight" }
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
      return { accepted: false, status: "invalid-model", reason: "missing provider prefix" }
    }

    const hadAwaitingFallbackResult = sessionAwaitingFallbackResult.has(sessionID)
    const previousPendingFallbackModel = sessionStates.get(sessionID)?.pendingFallbackModel
    const previousPendingFallbackPromptMayHaveBeenAccepted = sessionStates.get(sessionID)?.pendingFallbackPromptMayHaveBeenAccepted
    sessionRetryInFlight.add(sessionID)
    let retryDispatched = false
    let retryMayHaveBeenAccepted = false
    let acceptedStatus: AutoRetryDispatchOutcome["status"] = "dispatched"
    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      const retryPayload = getLastUserRetryPayload(messagesResp, sessionID)
      const originalRetryMetadata = resolveOriginalUserRetryMetadata(messagesResp)
      const fetchedParts = originalRetryMetadata.parts.length > 0
        ? originalRetryMetadata.parts
        : retryPayload.retryParts
      const usingFetchedUserParts = originalRetryMetadata.parts.length > 0
      const retryParts =
        fetchedParts.length > 0
          ? fetchedParts
          : (() => {
              log(
                `[${HOOK_NAME}] No user message parts found for auto-retry (${source}); using synthetic continuation`,
                {
                  sessionID,
                  hint: "This can occur when the working directory contains .git and messages are not yet persisted",
                },
              )
              // Mark the retry as internally initiated so continuation hooks
              // do not render a user-visible bare "continue" turn (#4085).
              return [createInternalAgentContinuationTextPart("continue")]
            })()
      const retryMessageID = usingFetchedUserParts ? originalRetryMetadata.messageID : undefined
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

      const retryPromptInput = {
        path: { id: sessionID },
        body: {
          ...(launchAgent ? { agent: launchAgent } : {}),
          ...retryModelPayload,
          ...(retryPayload.system ? { system: retryPayload.system } : {}),
          ...(retryPayload.tools ? { tools: retryPayload.tools } : {}),
          ...(retryMessageID ? { messageID: retryMessageID } : {}),
          parts: retryParts,
        },
        query: { directory: ctx.directory },
      }
      // Our own abort leaves a dangling assistant turn with no terminal error, which
      // the gate's assistant-active check would treat as blocking forever. Skip it.
      const wasInternallyAborted = internallyAbortedSessions.has(sessionID)
      const dispatchRetryPrompt = (retrySource: string, queueBehavior?: "defer") => dispatchInternalPrompt({
        mode: "async",
        client: ctx.client,
        sessionID,
        source: retrySource,
        settleMs: 0,
        ...(queueBehavior ? { queueBehavior } : {}),
        ...(wasInternallyAborted ? { checkToolState: false } : {}),
        input: retryPromptInput,
      })

      let promptResult = await dispatchRetryPrompt(`runtime-fallback:${source}`, "defer")
      if (promptResult.status === "active") {
        log(`[${HOOK_NAME}] Session active, queueing fallback dispatch (${source})`, {
          sessionID,
        })
        promptResult = await dispatchRetryPrompt(`runtime-fallback:${source}:active-queue`)
        acceptedStatus = "queued"
      }
      if (promptResult.status === "failed") {
        if (isAmbiguousPostDispatchPromptFailure(promptResult)) {
          retryMayHaveBeenAccepted = true
          log(`[${HOOK_NAME}] Auto-retry prompt failed after dispatch may have been accepted (${source}); preserving fallback state`, {
            sessionID,
            error: String(promptResult.error),
          })
          return { accepted: true, status: "possibly-accepted" }
        }
        throw promptResult.error
      }
      if (promptResult.status === "reserved") {
        // Session still has an active reservation from the cancelled stream.
        // Retry with linear backoff until the reservation is released.
        const maxReservedRetries = config.reserved_retry_attempts ?? 6
        const baseDelayMs = config.reserved_retry_base_delay_ms ?? 500
        let reservedResult: InternalPromptDispatchResult = promptResult
        for (let attempt = 0; attempt < maxReservedRetries; attempt++) {
          const delay = baseDelayMs * (attempt + 1)
          log(`[${HOOK_NAME}] Session reserved, retrying fallback dispatch in ${delay}ms (${source})`, {
            sessionID,
            attempt: attempt + 1,
            maxAttempts: maxReservedRetries,
          })
          await new Promise((r) => setTimeout(r, delay))
          reservedResult = await dispatchRetryPrompt(
            `runtime-fallback:${source}:reserved-retry-${attempt + 1}`,
            "defer",
          )
          if (reservedResult.status !== "reserved") break
        }
        if (reservedResult.status === "failed") {
          if (isAmbiguousPostDispatchPromptFailure(reservedResult)) {
            retryMayHaveBeenAccepted = true
            log(`[${HOOK_NAME}] Auto-retry prompt failed after dispatch may have been accepted (${source}); preserving fallback state`, {
              sessionID,
              error: String(reservedResult.error),
            })
            return { accepted: true, status: "possibly-accepted" }
          }
          throw reservedResult.error
        }
        if (!isInternalPromptDispatchAccepted(reservedResult)) {
          log(`[${HOOK_NAME}] Auto-retry skipped by promptAsync gate after reserved retries (${source})`, {
            sessionID,
            status: reservedResult.status,
          })
          return { accepted: false, status: "blocked", reason: `prompt gate returned ${reservedResult.status}` }
        }
        acceptedStatus = "queued"
      } else if (!isInternalPromptDispatchAccepted(promptResult)) {
        log(`[${HOOK_NAME}] Auto-retry skipped by promptAsync gate (${source})`, {
          sessionID,
          status: promptResult.status,
        })
        return { accepted: false, status: "blocked", reason: `prompt gate returned ${promptResult.status}` }
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
      return { accepted: true, status: acceptedStatus }
    } catch (retryError) {
      if (!(retryError instanceof Error)) {
        log(`[${HOOK_NAME}] Auto-retry failed (${source})`, { sessionID, error: String(retryError) })
        return { accepted: false, status: "failed", reason: String(retryError) }
      }
      log(`[${HOOK_NAME}] Auto-retry failed (${source})`, { sessionID, error: String(retryError) })
      return { accepted: false, status: "failed", reason: retryError.message }
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
    }
  }
}
