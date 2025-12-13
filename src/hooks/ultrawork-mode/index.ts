import { detectUltraworkKeyword, extractPromptText } from "./detector"
import { ULTRAWORK_CONTEXT } from "./constants"
import type { UltraworkModeState } from "./types"
import { log } from "../../shared"
import { injectHookMessage } from "../../features/hook-message-injector"

export * from "./detector"
export * from "./constants"
export * from "./types"

const ultraworkModeState = new Map<string, UltraworkModeState>()

export function clearUltraworkModeState(sessionID: string): void {
  ultraworkModeState.delete(sessionID)
}

export function createUltraworkModeHook() {
  return {
    /**
     * chat.message hook - detect ultrawork/ulw keywords, inject context via history
     *
     * Execution timing: AFTER claudeCodeHooks["chat.message"]
     * Behavior:
     *   1. Extract text from user prompt
     *   2. Detect ultrawork/ulw keywords (excluding code blocks)
     *   3. If detected, inject ULTRAWORK_CONTEXT via injectHookMessage (history injection)
     */
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      const state: UltraworkModeState = {
        detected: false,
        injected: false,
      }

      const promptText = extractPromptText(output.parts)

      if (!detectUltraworkKeyword(promptText)) {
        ultraworkModeState.set(input.sessionID, state)
        return
      }

      state.detected = true
      log("Ultrawork keyword detected", { sessionID: input.sessionID })

      const message = output.message as {
        agent?: string
        model?: { modelID?: string; providerID?: string }
        path?: { cwd?: string; root?: string }
        tools?: Record<string, boolean>
      }

      const success = injectHookMessage(input.sessionID, ULTRAWORK_CONTEXT, {
        agent: message.agent,
        model: message.model,
        path: message.path,
        tools: message.tools,
      })

      if (success) {
        state.injected = true
        log("Ultrawork context injected via history", { sessionID: input.sessionID })
      } else {
        log("Ultrawork context injection failed", { sessionID: input.sessionID })
      }

      ultraworkModeState.set(input.sessionID, state)
    },

    /**
     * event hook - cleanup session state on deletion
     */
    event: async ({
      event,
    }: {
      event: { type: string; properties?: unknown }
    }) => {
      if (event.type === "session.deleted") {
        const props = event.properties as
          | { info?: { id?: string } }
          | undefined
        if (props?.info?.id) {
          ultraworkModeState.delete(props.info.id)
        }
      }
    },
  }
}
