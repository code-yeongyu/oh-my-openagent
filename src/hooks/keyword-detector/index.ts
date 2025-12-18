import { detectKeywords, extractPromptText } from "./detector"
import { log } from "../../shared"
import { injectHookMessage } from "../../features/hook-message-injector"

export * from "./detector"
export * from "./constants"
export * from "./types"

export function createKeywordDetectorHook() {
  return {
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
      const promptText = extractPromptText(output.parts)
      const messages = detectKeywords(promptText)

      if (messages.length === 0) {
        return
      }

      log(`Keywords detected: ${messages.length}`, { sessionID: input.sessionID })

      const message = output.message as {
        agent?: string
        model?: { modelID?: string; providerID?: string }
        path?: { cwd?: string; root?: string }
        tools?: Record<string, boolean>
      }

      const context = messages.join("\n")
      log(`[keyword-detector] Injecting context for ${messages.length} keywords`, { sessionID: input.sessionID, contextLength: context.length })
      const success = injectHookMessage(input.sessionID, context, {
        agent: message.agent,
        model: message.model,
        path: message.path,
        tools: message.tools,
      })

      if (success) {
        log("Keyword context injected", { sessionID: input.sessionID })
      }
    },
  }
}
