import type { HookDeps } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { extractStatusCode, extractErrorName, classifyErrorType, isRetryableError, extractAutoRetrySignal, containsErrorContent } from "./error-classifier"
import { canPrepareFallback, createFallbackState } from "./fallback-state"
import { getFallbackModelsForSession } from "./fallback-models"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import { hasVisibleAssistantResponse } from "./visible-assistant-response"
import { subagentSessions } from "../../features/claude-code-session-state"
import { resolveMessageEventSessionID } from "../../shared/event-session-id"
import { normalizeModelToCanonicalString } from "./normalize-model"
import { isCompactionAgent, hasCompactionPart } from "../../shared/compaction-marker"
import { isCompactionInFlight } from "../../shared/compaction-in-flight"

export { hasVisibleAssistantResponse } from "./visible-assistant-response"

export function createMessageUpdateHandler(deps: HookDeps, helpers: AutoRetryHelpers) {
  const { ctx, config, pluginConfig, sessionStates, sessionLastAccess, sessionRetryInFlight, sessionAwaitingFallbackResult, sessionStatusRetryKeys } = deps
  const exhaustionToastStates = deps.fallbackExhaustionToastStates ?? new Map<string, ReturnType<typeof createFallbackState>>()
  const checkVisibleResponse = hasVisibleAssistantResponse(extractAutoRetrySignal)
  const showExhaustedToast = async (sessionID: string, state?: ReturnType<typeof createFallbackState>) => {
    if (state ? exhaustionToastStates.get(sessionID) === state : exhaustionToastStates.has(sessionID)) return
    exhaustionToastStates.set(sessionID, state ?? createFallbackState("unknown"))
    try {
      await ctx.client.tui.showToast({ body: {
        title: "Runtime fallback",
        message: "Fallback attempts exhausted; native retry continues",
        variant: "warning",
        duration: 3000,
      } })
    } catch (toastError) {
      log(`[${HOOK_NAME}] fallback exhaustion toast failed`, { sessionID, error: String(toastError) })
    }
  }

  return async (props: Record<string, unknown> | undefined) => {
    const info = props?.info as Record<string, unknown> | undefined
    const sessionID = resolveMessageEventSessionID(props)
    const timeoutEnabled = config.timeout_seconds > 0
    const eventParts = props?.parts as Array<{ type?: string; text?: string }> | undefined
    const infoParts = info?.parts as Array<{ type?: string; text?: string }> | undefined
    const parts = eventParts && eventParts.length > 0 ? eventParts : infoParts
    const retrySignalResult = extractAutoRetrySignal(info)
    const partsText = (parts ?? [])
      .filter((p) => typeof p?.text === "string")
      .map((p) => (p.text ?? "").trim())
      .filter((text) => text.length > 0)
      .join("\n")
    const retrySignalFromParts = partsText
      ? extractAutoRetrySignal({ message: partsText, status: partsText, summary: partsText })?.signal
      : undefined
    const retrySignal = retrySignalResult?.signal ?? retrySignalFromParts
    const errorContentResult = containsErrorContent(parts)
    const error = info?.error ?? 
      (retrySignal && timeoutEnabled ? { name: "ProviderRateLimitError", message: retrySignal } : undefined) ??
      (errorContentResult.hasError ? { name: "MessageContentError", message: errorContentResult.errorMessage || "Message contains error content" } : undefined)
    const role = info?.role as string | undefined
    const model = normalizeModelToCanonicalString(info?.model)
    const isCompactionMessage = role === "assistant" && (
      isCompactionAgent(info?.agent)
      || info?.mode === "compaction"
      || info?.summary === true
      || hasCompactionPart(parts)
    )

    if (isCompactionMessage) return

    if (sessionID && role === "assistant" && isCompactionInFlight(sessionID)) {
      log(`[${HOOK_NAME}] retry signal belongs to compaction lane; primary chain untouched (compaction-lane-retry-ignored)`, { sessionID })
      return
    }

    if (sessionID && role === "assistant" && !error) {
      if (!sessionAwaitingFallbackResult.has(sessionID)) {
        return
      }

      // Layer-2 guard: when omo's own fallback machinery aborted the in-flight
      // request, the assistant message update carries no visible content and no
      // error — this is an internal abort artifact, not a real response. Skip
      // the visible-response check to avoid "Assistant update observed without
      // visible final response" log noise for every fallback hop.
      if (sessionRetryInFlight.has(sessionID)) {
        return
      }

      const hasVisible = await checkVisibleResponse(ctx, sessionID, info)
      if (!hasVisible) {
        log(`[${HOOK_NAME}] Assistant update observed without visible final response; keeping fallback timeout`, {
          sessionID,
          model,
        })
        return
      }

      sessionAwaitingFallbackResult.delete(sessionID)
      sessionStatusRetryKeys.delete(sessionID)
      helpers.clearSessionFallbackTimeout(sessionID)
      let state = sessionStates.get(sessionID)
      if (state?.pendingFallbackModel) {
        state.pendingFallbackModel = undefined
        state.pendingFallbackPromptMayHaveBeenAccepted = false
      }
      log(`[${HOOK_NAME}] Assistant response observed; cleared fallback timeout`, { sessionID, model })
      return
    }

    if (sessionID && role === "assistant" && error) {
      let state = sessionStates.get(sessionID)
      const pendingFallbackModel = state?.pendingFallbackModel
      const wasAwaitingFallbackResult = sessionAwaitingFallbackResult.has(sessionID)
      if (
        wasAwaitingFallbackResult &&
        pendingFallbackModel &&
        !retrySignal &&
        model !== pendingFallbackModel
      ) {
        log(`[${HOOK_NAME}] message.updated fallback skipped - awaiting fallback result`, {
          sessionID,
          pendingFallbackModel,
          model,
        })
        return
      }
      if (wasAwaitingFallbackResult) {
        sessionAwaitingFallbackResult.delete(sessionID)
      }
      if (sessionRetryInFlight.has(sessionID) && !retrySignal) {
        log(`[${HOOK_NAME}] message.updated fallback skipped (retry in flight)`, { sessionID })
        return
      }

      const agent = info?.agent as string | undefined
      const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent)
      if (retrySignal && timeoutEnabled && (sessionRetryInFlight.has(sessionID) || wasAwaitingFallbackResult)) {
        log(`[${HOOK_NAME}] Overriding active retry due to provider auto-retry signal`, {
          sessionID,
          model,
        })
        const availableModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)
        if (!canPrepareFallback(state, availableModels, deps.config, model)) {
          log(`[${HOOK_NAME}] fallback exhausted; leaving native retry running (fallback-exhausted-no-abort)`, { sessionID })
          await showExhaustedToast(sessionID, state)
          return
        }
        await helpers.abortSessionRequest(sessionID, "message.updated.retry-signal")
        sessionRetryInFlight.delete(sessionID)
      }

      if (retrySignal && timeoutEnabled) {
        log(`[${HOOK_NAME}] Detected provider auto-retry signal`, { sessionID, model })
      }

      if (!retrySignal) {
        helpers.clearSessionFallbackTimeout(sessionID)
      }

      log(`[${HOOK_NAME}] message.updated with assistant error`, {
        sessionID,
        model,
        statusCode: extractStatusCode(error, config.retry_on_errors),
        errorName: extractErrorName(error),
        errorType: classifyErrorType(error),
      })

      const terminalQuota402Abort =
        classifyErrorType(error) === "abort" && extractStatusCode(error, config.retry_on_errors) === 402

      if (!isRetryableError(error, config.retry_on_errors)) {
        if (!terminalQuota402Abort) {
          log(`[${HOOK_NAME}] message.updated error not retryable, skipping fallback`, {
            sessionID,
            statusCode: extractStatusCode(error, config.retry_on_errors),
            errorName: extractErrorName(error),
            errorType: classifyErrorType(error),
          })
          return
        }
        log(`[${HOOK_NAME}] message.updated terminal-quota 402 abort with fallback chain; dispatching session-stable fallback`, {
          sessionID,
          statusCode: extractStatusCode(error, config.retry_on_errors),
          errorName: extractErrorName(error),
          errorType: classifyErrorType(error),
        })
      }

      const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, pluginConfig)

      if (fallbackModels.length === 0) {
        if (
          subagentSessions.has(sessionID) &&
          classifyErrorType(error) === "quota_exceeded"
        ) {
          log(`[${HOOK_NAME}] Aborting subagent on unrecoverable quota error (no fallback configured)`, {
            sessionID,
            model,
          })
          await helpers.abortSessionRequest(sessionID, "message.updated.subagent-quota-no-fallback")
        }
        return
      }

      if (!state) {
        const initialModel = await resolveFallbackBootstrapModel({
          sessionID,
          source: "message.updated",
          eventModel: model,
          resolvedAgent,
          pluginConfig,
          ctx,
        })

        if (!initialModel) {
          log(`[${HOOK_NAME}] message.updated missing model info, cannot fallback`, {
            sessionID,
            errorName: extractErrorName(error),
            errorType: classifyErrorType(error),
          })
          return
        }

        state = createFallbackState(initialModel)
        sessionStates.set(sessionID, state)
        sessionLastAccess.set(sessionID, Date.now())
      } else {
        sessionLastAccess.set(sessionID, Date.now())

        if (state.pendingFallbackModel) {
          if (retrySignal && timeoutEnabled) {
            log(`[${HOOK_NAME}] Clearing pending fallback due to provider auto-retry signal`, {
              sessionID,
              pendingFallbackModel: state.pendingFallbackModel,
            })
            state.pendingFallbackModel = undefined
            state.pendingFallbackPromptMayHaveBeenAccepted = false
          } else {
            log(`[${HOOK_NAME}] message.updated fallback skipped (pending fallback in progress)`, {
              sessionID,
              pendingFallbackModel: state.pendingFallbackModel,
            })
            return
          }
        }
      }

      if (classifyErrorType(error) === "quota_exceeded") {
        if (!canPrepareFallback(state, fallbackModels, deps.config, model)) {
          log(`[${HOOK_NAME}] fallback exhausted; leaving quota retry untouched (fallback-exhausted-no-abort)`, { sessionID })
          await showExhaustedToast(sessionID, state)
          return
        }
        await helpers.abortSessionRequest(sessionID, "message.updated.quota-fallback")
        sessionRetryInFlight.delete(sessionID)
      }

      await dispatchFallbackRetry(deps, helpers, {
        sessionID,
        state,
        fallbackModels,
        resolvedAgent,
        source: "message.updated",
      })
    }
  }
}
