import type { HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { createFallbackState, isModelInCooldown, stripVariant } from "./fallback-state"

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

    const requestedModel = input.model
      ? `${input.model.providerID}/${input.model.modelID}`
      : undefined

    const reqLower = requestedModel ? requestedModel.toLowerCase() : undefined

    if (reqLower && reqLower !== stripVariant(state.currentModel).toLowerCase()) {
      if (state.pendingFallbackModel && stripVariant(state.pendingFallbackModel).toLowerCase() === reqLower) {
        state.pendingFallbackModel = undefined
        state.pendingFallbackPromptMayHaveBeenAccepted = false
        return
      }

      log(`[${HOOK_NAME}] Detected manual model change, resetting fallback state`, {
        sessionID,
        from: state.currentModel,
        to: requestedModel,
        debug_reqLower: reqLower,
        debug_stripVariant: stripVariant(state.currentModel).toLowerCase()
      })
      state = createFallbackState(requestedModel!)
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

      const parts = activeModel.split("/")
      if (parts.length >= 2) {
        output.message.model = {
          providerID: parts[0],
          modelID: stripVariant(parts.slice(1).join("/")),
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
        // Strip the variant suffix (e.g. '(medium)') from the modelID.
        // Opencode requires variants to be stored in the agentSettings payload rather than the modelID itself.
        // Failing to strip the variant will result in a ProviderModelNotFoundError and break the fallback chain.
        output.message.model = {
          providerID: parts[0],
          modelID: stripVariant(parts.slice(1).join("/")),
        }
      }
    }
  }
}
