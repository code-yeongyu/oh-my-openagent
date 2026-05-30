import type { HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { createFallbackState, isModelInCooldown } from "./fallback-state"

function assignModelOverride(
  output: { message: { model?: { providerID: string; modelID: string } } },
  model: string,
): void {
  const parts = model.split("/")
  if (parts.length >= 2) {
    output.message.model = {
      providerID: parts[0],
      modelID: parts.slice(1).join("/"),
    }
  }
}

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

    if (requestedModel && requestedModel !== state.currentModel) {
      if (state.pendingFallbackModel && state.pendingFallbackModel === requestedModel) {
        state.pendingFallbackModel = undefined
        state.pendingFallbackPromptMayHaveBeenAccepted = false
        return
      }

      log(`[${HOOK_NAME}] Detected manual model change, resetting fallback state`, {
        sessionID,
        from: state.currentModel,
        to: requestedModel,
      })
      state = createFallbackState(requestedModel)
      sessionStates.set(sessionID, state)
      return
    }

    const shouldRestorePrimaryModel =
      state.currentModel !== state.originalModel &&
      (
        state.restorePrimaryOnNextMessage === true ||
        !state.pendingFallbackModel &&
          !isModelInCooldown(state.originalModel, state, config.cooldown_seconds)
      )

    if (shouldRestorePrimaryModel) {
      log(`[${HOOK_NAME}] Restoring preferred primary model`, {
        sessionID,
        from: state.currentModel,
        to: state.originalModel,
        reason: state.restorePrimaryOnNextMessage ? "reopened-fallback-session" : "cooldown-expired",
      })

      state = createFallbackState(state.originalModel)
      sessionStates.set(sessionID, state)

      if (output.message) {
        assignModelOverride(output, state.originalModel)
      }
      return
    }

    if (state.currentModel === state.originalModel) return

    const activeModel = state.currentModel

    log(`[${HOOK_NAME}] Applying fallback model override`, {
      sessionID,
      from: input.model,
      to: activeModel,
    })

    if (output.message && activeModel) {
      assignModelOverride(output, activeModel)
    }
  }
}
