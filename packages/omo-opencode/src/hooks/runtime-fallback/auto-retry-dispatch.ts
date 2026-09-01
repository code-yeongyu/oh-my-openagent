import type { AutoRetryDispatchOutcome, HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { getSessionAgent, resolveRegisteredAgentName } from "../../features/claude-code-session-state"
import { buildRetryModelPayload } from "./retry-model-payload"
import { getLastUserRetryPayload } from "./last-user-retry-parts"
import {
  createRuntimeFallbackRetryTextPart,
  hasRuntimeFallbackRetryMarker,
  OMO_RUNTIME_FALLBACK_RETRY_MARKER,
} from "../../shared/runtime-fallback-retry-marker"
import { hasInternalInitiatorMarker } from "../../shared/internal-initiator-marker"
import {
  dispatchInternalPrompt,
  isInternalPromptDispatchAccepted,
  type InternalPromptDispatchResult,
} from "../shared/prompt-async-gate"
import { isAmbiguousPostDispatchPromptFailure } from "../../shared/prompt-failure-classifier"
import { resolveOriginalUserRetryMetadata } from "./auto-retry-metadata"
import { stringifyRuntimeModelWithVariant } from "./fallback-state"
import { resolveRuntimeModelSettings } from "./runtime-model-settings"

export function createAutoRetryDispatcher(
  deps: HookDeps,
  scheduleSessionFallbackTimeout: (sessionID: string, resolvedAgent?: string) => void,
  clearSessionFallbackTimeout: (sessionID: string) => void,
) {
  const {
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

    const retryModelPayload = buildRetryModelPayload(
      newModel,
      resolveRuntimeModelSettings(sessionID, resolvedAgent, pluginConfig),
    )
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
    const fallbackState = sessionStates.get(sessionID)
    const isCurrentFallbackGeneration = () => sessionStates.get(sessionID) === fallbackState
    const staleGenerationOutcome = (): AutoRetryDispatchOutcome => {
      log(`[${HOOK_NAME}] Auto-retry skipped for stale fallback generation (${source})`, {
        sessionID,
      })
      return { accepted: false, status: "blocked", reason: "stale fallback generation" }
    }
    const previousCurrentModel = fallbackState?.currentModel
    const previousPendingFallbackModel = fallbackState?.pendingFallbackModel
    const previousPendingFallbackPromptMayHaveBeenAccepted = fallbackState?.pendingFallbackPromptMayHaveBeenAccepted
    const effectiveRetryModel = stringifyRuntimeModelWithVariant(
      retryModelPayload.model,
      retryModelPayload.variant,
    )
    if (fallbackState && effectiveRetryModel) {
      fallbackState.currentModel = effectiveRetryModel
      fallbackState.pendingFallbackModel = effectiveRetryModel
    }
    sessionRetryInFlight.add(sessionID)
    let retryDispatched = false
    let retryMayHaveBeenAccepted = false
    let acceptedStatus: AutoRetryDispatchOutcome["status"] = "dispatched"
    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      if (!isCurrentFallbackGeneration()) return staleGenerationOutcome()

      const retryPayload = getLastUserRetryPayload(messagesResp, sessionID)
      const originalRetryMetadata = resolveOriginalUserRetryMetadata(messagesResp)
      const fetchedParts = originalRetryMetadata.parts.length > 0
        ? originalRetryMetadata.parts
        : retryPayload.retryParts
      const usingFetchedUserParts = originalRetryMetadata.parts.length > 0
      const retryParts =
        fetchedParts.length > 0
          ? fetchedParts.map((part) => (
              hasInternalInitiatorMarker(part.text) && !hasRuntimeFallbackRetryMarker(part.text)
                ? { ...part, text: `${part.text}\n${OMO_RUNTIME_FALLBACK_RETRY_MARKER}` }
                : part
            ))
          : (() => {
              log(
                `[${HOOK_NAME}] No user message parts found for auto-retry (${source}); using synthetic continuation`,
                {
                  sessionID,
                  hint: "This can occur when the working directory contains .git and messages are not yet persisted",
                },
              )
              // Mark this specifically as a fallback retry so the chat adapter
              // can acknowledge it without treating other synthetic prompts as fallback generations.
              return [createRuntimeFallbackRetryTextPart("continue")]
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
        shouldDispatch: isCurrentFallbackGeneration,
        input: retryPromptInput,
      })

      if (!isCurrentFallbackGeneration()) return staleGenerationOutcome()
      let promptResult = await dispatchRetryPrompt(`runtime-fallback:${source}`, "defer")
      if (!isCurrentFallbackGeneration()) return staleGenerationOutcome()
      if (promptResult.status === "active") {
        log(`[${HOOK_NAME}] Session active, queueing fallback dispatch (${source})`, {
          sessionID,
        })
        promptResult = await dispatchRetryPrompt(`runtime-fallback:${source}:active-queue`)
        if (!isCurrentFallbackGeneration()) return staleGenerationOutcome()
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
        const MAX_RESERVED_RETRIES = 6
        const BASE_DELAY_MS = 500
        let reservedResult: InternalPromptDispatchResult = promptResult
        for (let attempt = 0; attempt < MAX_RESERVED_RETRIES; attempt++) {
          const delay = BASE_DELAY_MS * (attempt + 1)
          log(`[${HOOK_NAME}] Session reserved, retrying fallback dispatch in ${delay}ms (${source})`, {
            sessionID,
            attempt: attempt + 1,
            maxAttempts: MAX_RESERVED_RETRIES,
          })
          await new Promise((r) => setTimeout(r, delay))
          if (!isCurrentFallbackGeneration()) return staleGenerationOutcome()
          reservedResult = await dispatchRetryPrompt(
            `runtime-fallback:${source}:reserved-retry-${attempt + 1}`,
            "defer",
          )
          if (!isCurrentFallbackGeneration()) return staleGenerationOutcome()
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
      if (!isCurrentFallbackGeneration()) return staleGenerationOutcome()
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
      const ownsFallbackGeneration = isCurrentFallbackGeneration()
      if (ownsFallbackGeneration) {
        sessionRetryInFlight.delete(sessionID)
      }
      if (retryMayHaveBeenAccepted && ownsFallbackGeneration && fallbackState) {
        fallbackState.pendingFallbackPromptMayHaveBeenAccepted = true
      }
      if (!retryDispatched && !retryMayHaveBeenAccepted && ownsFallbackGeneration) {
        if (hadAwaitingFallbackResult) {
          sessionAwaitingFallbackResult.add(sessionID)
        } else {
          sessionAwaitingFallbackResult.delete(sessionID)
          clearSessionFallbackTimeout(sessionID)
        }
        if (fallbackState) {
          fallbackState.currentModel = previousCurrentModel ?? fallbackState.currentModel
          if (hadAwaitingFallbackResult) {
            fallbackState.pendingFallbackModel = previousPendingFallbackModel
            fallbackState.pendingFallbackPromptMayHaveBeenAccepted = previousPendingFallbackPromptMayHaveBeenAccepted
          } else if (fallbackState.pendingFallbackModel) {
            fallbackState.pendingFallbackModel = undefined
            fallbackState.pendingFallbackPromptMayHaveBeenAccepted = false
          }
        }
      }
    }
  }
}
