import type { HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { createFallbackState } from "./fallback-state"

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

    const stripVariant = (m: any) => String(m).replace(/\(.*?\)$/, "").toLowerCase()
    const reqLower = requestedModel ? requestedModel.toLowerCase() : undefined

    if (reqLower && reqLower !== stripVariant(state.currentModel)) {
      if (state.pendingFallbackModel && stripVariant(state.pendingFallbackModel) === reqLower) {
        state.pendingFallbackModel = undefined
        state.pendingFallbackPromptMayHaveBeenAccepted = false
        return
      }

      log(`[${HOOK_NAME}] Detected manual model change, resetting fallback state`, {
        sessionID,
        from: state.currentModel,
        to: requestedModel,
        debug_reqLower: reqLower,
        debug_stripVariant: stripVariant(state.currentModel)
      })
      state = createFallbackState(requestedModel!)
      sessionStates.set(sessionID, state)
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
      const parts = activeModel.split("/")
      if (parts.length >= 2) {
        // Strip the variant suffix (e.g. '(medium)') from the modelID.
        // Opencode requires variants to be stored in the agentSettings payload rather than the modelID itself.
        // Failing to strip the variant will result in a ProviderModelNotFoundError and break the fallback chain.
        output.message.model = {
          providerID: parts[0],
          modelID: parts.slice(1).join("/").replace(/\(.*?\)$/, ""),
        }
      }
    }
  }
}
