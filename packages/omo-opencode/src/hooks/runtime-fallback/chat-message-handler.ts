import type { HookDeps } from "./types"
import type { RuntimeFallbackTimeout } from "./types"
import { parseModelString } from "@oh-my-opencode/model-core"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { createFallbackState, isModelInCooldown, stringifyRuntimeModelWithVariant } from "./fallback-state"
import { buildRetryModelPayload } from "./retry-model-payload"
import { resolveRuntimeModelSettings } from "./runtime-model-settings"
import { getSessionAgent } from "../../features/claude-code-session-state"

declare function clearTimeout(timeout: RuntimeFallbackTimeout): void

export function createChatMessageHandler(deps: HookDeps) {
  const {
    config,
    sessionStates,
    sessionLastAccess,
    sessionAwaitingFallbackResult,
    sessionFallbackTimeouts,
    sessionStatusRetryKeys,
    sessionRetryInFlight,
  } = deps

  function clearFallbackWatchdog(sessionID: string): void {
    sessionAwaitingFallbackResult.delete(sessionID)
    const timer = sessionFallbackTimeouts.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      sessionFallbackTimeouts.delete(sessionID)
    }
  }

  function clearModelLessRetryKeys(sessionID: string): void {
    const retryKeys = sessionStatusRetryKeys.get(sessionID)
    if (!retryKeys) return

    for (const retryKey of retryKeys) {
      if (retryKey.startsWith("unknown:")) {
        retryKeys.delete(retryKey)
      }
    }
    if (retryKeys.size === 0) {
      sessionStatusRetryKeys.delete(sessionID)
    }
  }

  function applyRuntimeModel(
    message: { model?: { providerID: string; modelID: string }; variant?: string },
    runtimeModel: string,
  ): void {
    const parsedModel = parseModelString(runtimeModel)
    if (!parsedModel) return

    message.model = {
      providerID: parsedModel.providerID,
      modelID: parsedModel.modelID,
    }
    if (parsedModel.variant) {
      message.variant = parsedModel.variant
    } else {
      delete message.variant
    }
  }

  return async (
    input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; variant?: string },
    output: { message: { model?: { providerID: string; modelID: string }; variant?: string }; parts?: Array<{ type: string; text?: string }> }
  ) => {
    if (!config.enabled) return

    const { sessionID } = input
    let state = sessionStates.get(sessionID)

    if (!state) return

    sessionLastAccess.set(sessionID, Date.now())

    const requestedModel = stringifyRuntimeModelWithVariant(
      input.model,
      output.message.variant ?? input.variant,
    )

    if (requestedModel && state.pendingFallbackModel === requestedModel) {
      state.pendingFallbackModel = undefined
      state.pendingFallbackPromptMayHaveBeenAccepted = false
      clearModelLessRetryKeys(sessionID)
      return
    }

    if (requestedModel && requestedModel !== state.currentModel) {
      log(`[${HOOK_NAME}] Detected manual model change, resetting fallback state`, {
        sessionID,
        from: state.currentModel,
        to: requestedModel,
      })
      state = createFallbackState(requestedModel)
      sessionStates.set(sessionID, state)
      clearFallbackWatchdog(sessionID)
      sessionRetryInFlight.delete(sessionID)
      sessionStatusRetryKeys.delete(sessionID)
      return
    }

    if (
      config.restore_primary_after_cooldown &&
      state.currentModel !== state.originalModel &&
      !state.pendingFallbackModel &&
      !isModelInCooldown(state.originalModel, state, config.cooldown_seconds)
    ) {
      const primaryPayload = buildRetryModelPayload(
        state.originalModel,
        resolveRuntimeModelSettings(sessionID, input.agent ?? getSessionAgent(sessionID), deps.pluginConfig),
      )
      const activeModel = primaryPayload
        ? stringifyRuntimeModelWithVariant(primaryPayload.model, primaryPayload.variant) ?? state.originalModel
        : state.originalModel
      log(`[${HOOK_NAME}] Restoring preferred primary model`, {
        sessionID,
        from: state.currentModel,
        to: activeModel,
      })
      sessionStates.set(sessionID, createFallbackState(activeModel))
      applyRuntimeModel(output.message, activeModel)
      return
    }

    const activeModel = state.currentModel

    if (activeModel === state.originalModel) return

    log(`[${HOOK_NAME}] Applying fallback model override`, {
      sessionID,
      from: input.model,
      to: activeModel,
    })

    if (output.message && activeModel) applyRuntimeModel(output.message, activeModel)
  }
}
