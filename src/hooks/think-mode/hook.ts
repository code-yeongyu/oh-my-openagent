import { detectThinkKeyword, extractPromptText } from "./detector"
import { getHighVariant, getThinkingConfig, isAlreadyHighVariant } from "./switcher"
import type { ThinkModeInput, ThinkModeState } from "./types"
import { log } from "../../shared"

const MAX_THINK_MODE_ENTRIES = 1000
const thinkModeState = new Map<string, ThinkModeState>()

export function setThinkModeState(key: string, value: ThinkModeState): void {
  if (thinkModeState.size >= MAX_THINK_MODE_ENTRIES && !thinkModeState.has(key)) {
    const oldest = thinkModeState.keys().next().value
    if (oldest !== undefined) thinkModeState.delete(oldest)
  }
  // Bump insertion order: delete + set re-inserts at the most recent position.
  thinkModeState.delete(key)
  thinkModeState.set(key, value)
}

export function getThinkModeState(key: string): ThinkModeState | undefined {
  const value = thinkModeState.get(key)
  if (value !== undefined) {
    // Bump to most recent position so active sessions are not evicted.
    thinkModeState.delete(key)
    thinkModeState.set(key, value)
  }
  return value
}

export function _getThinkModeStateSizeForTesting(): number {
  return thinkModeState.size
}

export function _resetThinkModeStateForTesting(): void {
  thinkModeState.clear()
}

export function clearThinkModeState(sessionID: string): void {
  thinkModeState.delete(sessionID)
}

export function createThinkModeHook() {
  function isDisabledThinkingConfig(config: Record<string, unknown>): boolean {
    const thinkingConfig = config.thinking
    if (
      typeof thinkingConfig === "object" &&
      thinkingConfig !== null &&
      "type" in thinkingConfig &&
      (thinkingConfig as { type?: string }).type === "disabled"
    ) {
      return true
    }

    const providerOptions = config.providerOptions
    if (typeof providerOptions !== "object" || providerOptions === null) {
      return false
    }

    return Object.values(providerOptions as Record<string, unknown>).some(
      (providerConfig) => {
        if (typeof providerConfig !== "object" || providerConfig === null) {
          return false
        }

        const providerConfigMap = providerConfig as Record<string, unknown>
        const extraBody = providerConfigMap.extra_body
        if (typeof extraBody !== "object" || extraBody === null) {
          return false
        }

        const extraBodyMap = extraBody as Record<string, unknown>
        const extraThinking = extraBodyMap.thinking
        return (
          typeof extraThinking === "object" &&
          extraThinking !== null &&
          (extraThinking as { type?: string }).type === "disabled"
        )
      }
    )
  }

  return {
    "chat.params": async (output: ThinkModeInput, sessionID: string): Promise<void> => {
      const promptText = extractPromptText(output.parts)

      const state: ThinkModeState = {
        requested: false,
        modelSwitched: false,
        thinkingConfigInjected: false,
      }

      if (!detectThinkKeyword(promptText)) {
        setThinkModeState(sessionID, state)
        return
      }

      state.requested = true

      const currentModel = output.message.model
      if (!currentModel) {
        setThinkModeState(sessionID, state)
        return
      }

      state.providerID = currentModel.providerID
      state.modelID = currentModel.modelID

      if (isAlreadyHighVariant(currentModel.modelID)) {
        setThinkModeState(sessionID, state)
        return
      }

      const highVariant = getHighVariant(currentModel.modelID)
      const thinkingConfig = getThinkingConfig(currentModel.providerID, currentModel.modelID)

      if (highVariant) {
        output.message.model = {
          providerID: currentModel.providerID,
          modelID: highVariant,
        }
        state.modelSwitched = true
        log("Think mode: model switched to high variant", {
          sessionID,
          from: currentModel.modelID,
          to: highVariant,
        })
      }

      if (thinkingConfig) {
        const messageData = output.message as Record<string, unknown>
        const agentThinking = messageData.thinking as { type?: string } | undefined
        const agentProviderOptions = messageData.providerOptions

        const agentDisabledThinking = agentThinking?.type === "disabled"
        const agentHasCustomProviderOptions = Boolean(agentProviderOptions)

        if (agentDisabledThinking) {
          log("Think mode: skipping - agent has thinking disabled", {
            sessionID,
            provider: currentModel.providerID,
          })
        } else if (agentHasCustomProviderOptions) {
          log("Think mode: skipping - agent has custom providerOptions", {
            sessionID,
            provider: currentModel.providerID,
          })
        } else if (
          !isDisabledThinkingConfig(thinkingConfig as Record<string, unknown>)
        ) {
          Object.assign(output.message, thinkingConfig)
          state.thinkingConfigInjected = true
          log("Think mode: thinking config injected", {
            sessionID,
            provider: currentModel.providerID,
            config: thinkingConfig,
          })
        } else {
          log("Think mode: skipping disabled thinking config", {
            sessionID,
            provider: currentModel.providerID,
          })
        }
      }

      setThinkModeState(sessionID, state)
    },

    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type === "session.deleted") {
        const props = event.properties as { info?: { id?: string } } | undefined
        if (props?.info?.id) {
          thinkModeState.delete(props.info.id)
        }
      }
    },
  }
}
