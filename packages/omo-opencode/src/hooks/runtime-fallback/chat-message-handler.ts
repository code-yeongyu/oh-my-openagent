import type { HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { createFallbackState, isModelInCooldown } from "./fallback-state"
import { restorePromptParams } from "./fallback-prompt-params"
import { normalizeModelToCanonicalString } from "./normalize-model"

export function createChatMessageHandler(deps: HookDeps) {
  const { config, sessionStates, sessionLastAccess } = deps

  return async (
    input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
    output: { message: { model?: { providerID: string; modelID: string } }; parts?: Array<{ type: string; text?: string }> }
  ) => {
    if (!config.enabled) return

    const { sessionID } = input
    let state = sessionStates.get(sessionID)

    if (!state) return

    sessionLastAccess.set(sessionID, Date.now())

    const requestedModel = normalizeModelToCanonicalString(input.model)

    if (requestedModel && state.pendingFallbackModel === requestedModel) {
      state.pendingFallbackModel = undefined
      state.pendingFallbackPromptMayHaveBeenAccepted = false
      return
    }

    if (requestedModel && requestedModel !== state.currentModel) {
      log(`[${HOOK_NAME}] Detected manual model change, resetting fallback state`, {
        sessionID,
        from: state.currentModel,
        to: requestedModel,
      })
      restorePromptParams(deps.sessionPromptParamsBeforeFallback, sessionID)
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
      log(`[${HOOK_NAME}] Restoring preferred primary model`, {
        sessionID,
        from: state.currentModel,
        to: activeModel,
      })
      sessionStates.set(sessionID, createFallbackState(activeModel))
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

    if (activeModel === state.originalModel) return

    log(`[${HOOK_NAME}] Applying fallback model override`, {
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
