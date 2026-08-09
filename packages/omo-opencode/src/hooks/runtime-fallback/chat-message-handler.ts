import type { HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { createFallbackState, isModelInCooldown } from "./fallback-state"
import { discardPromptParamsSnapshot, restorePromptParams } from "./fallback-prompt-params"
import { normalizeModelToCanonicalString } from "./normalize-model"
import { clearSessionPromptParams, getSessionPromptParams } from "../../shared"

export function createChatMessageHandler(deps: HookDeps) {
  const { config, sessionStates, sessionLastAccess } = deps

  return async (
    input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
    output: { message: { agent?: string; model?: { providerID: string; modelID: string }; variant?: string }; parts?: Array<{ type: string; text?: string }> }
  ) => {
    if (!config.enabled) return

    const { sessionID } = input
    let state = sessionStates.get(sessionID)

    if (!state) return

    sessionLastAccess.set(sessionID, Date.now())

    const requestedModel = normalizeModelToCanonicalString(input.model)
    const requestedVariant = typeof output.message.variant === "string"
      ? output.message.variant
      : undefined
    const resolvedAgent = typeof output.message.agent === "string"
      ? output.message.agent
      : input.agent
    const currentPromptParams = getSessionPromptParams(sessionID)
    const expectedVariant = requestedModel === state.originalModel
      && deps.sessionPromptParamsBeforeFallback?.has(sessionID)
      ? deps.sessionPromptParamsBeforeFallback.get(sessionID)?.variant
      : currentPromptParams?.variant
    const changedVariant = requestedVariant !== expectedVariant

    if (requestedModel && state.pendingFallbackModel === requestedModel) {
      state.pendingFallbackModel = undefined
      state.pendingFallbackPromptMayHaveBeenAccepted = false
      return
    }

    if (requestedModel && (requestedModel !== state.currentModel || changedVariant)) {
      log(`[${HOOK_NAME}] Detected manual model change, resetting fallback state`, {
        sessionID,
        from: state.currentModel,
        to: requestedModel,
      })
      if (requestedModel === state.originalModel && !changedVariant) {
        restorePromptParams(deps.sessionPromptParamsBeforeFallback, sessionID)
      } else {
        discardPromptParamsSnapshot(deps.sessionPromptParamsBeforeFallback, sessionID)
        clearSessionPromptParams(sessionID)
      }
      state = createFallbackState(requestedModel)
      sessionStates.set(sessionID, state)
      return
    }

    if (
      config.restore_primary_after_cooldown &&
      state.currentModel !== state.originalModel &&
      !state.pendingFallbackModel &&
      !isModelInCooldown(state.originalModel, state, config.cooldown_seconds)
    ) {
      const activeModel = state.originalModel
      const restoredState = createFallbackState(activeModel)
      restoredState.restoredPrimary = { staleModel: state.currentModel, agent: resolvedAgent }
      log(`[${HOOK_NAME}] Restoring preferred primary model`, {
        sessionID,
        from: state.currentModel,
        to: activeModel,
      })
      sessionStates.set(sessionID, restoredState)
      restorePromptParams(deps.sessionPromptParamsBeforeFallback, sessionID)

      const parts = activeModel.split("/")
      if (parts.length >= 2) {
        output.message.model = {
          providerID: parts[0],
          modelID: parts.slice(1).join("/"),
        }
      }
      return
    }

    const activeModel = state.currentModel
    const outputModel = normalizeModelToCanonicalString(output.message.model)
    if (state.restoredPrimary && outputModel === state.originalModel) {
      state.restoredPrimary.agent = resolvedAgent
    }
    const shouldReapplyRestoredPrimary = state.restoredPrimary !== undefined
      && requestedModel === undefined
      && outputModel === state.restoredPrimary.staleModel
      && resolvedAgent === state.restoredPrimary.agent

    if (activeModel === state.originalModel && !shouldReapplyRestoredPrimary) return

    log(`[${HOOK_NAME}] Applying active model override`, {
      sessionID,
      from: input.model,
      to: activeModel,
    })

    if (output.message && activeModel) {
      const parts = activeModel.split("/")
      if (parts.length >= 2) {
        output.message.model = {
          providerID: parts[0],
          modelID: parts.slice(1).join("/"),
        }
      }
    }
  }
}
