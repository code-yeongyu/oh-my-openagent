import { detectThinkKeyword, extractPromptText } from "./detector"
import { isAlreadyHighVariant } from "./switcher"
import type { ThinkModeState } from "./types"
import { log } from "../../shared"

const thinkModeState = new Map<string, ThinkModeState>()

export function clearThinkModeState(sessionID: string): void {
  thinkModeState.delete(sessionID)
}

export function createThinkModeHook() {
  return {
    "chat.message": async (
      input: {
        sessionID: string
        model?: { providerID: string; modelID: string }
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      const promptText = extractPromptText(output.parts)
      const sessionID = input.sessionID

      const state: ThinkModeState = {
        requested: false,
        modelSwitched: false,
        variantSet: false,
      }

      if (!detectThinkKeyword(promptText)) {
        thinkModeState.set(sessionID, state)
        return
      }

      state.requested = true

      if (typeof output.message.variant === "string") {
        thinkModeState.set(sessionID, state)
        return
      }

      const currentModel = input.model
      if (!currentModel) {
        thinkModeState.set(sessionID, state)
        return
      }

      state.providerID = currentModel.providerID
      state.modelID = currentModel.modelID

      if (isAlreadyHighVariant(currentModel.modelID)) {
        thinkModeState.set(sessionID, state)
        return
      }

      output.message.variant = "high"
      state.modelSwitched = false
      state.variantSet = true
      log("Think mode: variant set to high", { sessionID })

      thinkModeState.set(sessionID, state)
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
