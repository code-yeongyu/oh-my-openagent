import { detectKeywords, extractPromptText } from "./detector"
import { log } from "../../shared"
import { injectHookMessage } from "../../features/hook-message-injector"

export * from "./detector"
export * from "./constants"
export * from "./types"

const sessionFirstMessageProcessed = new Set<string>()

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
      const isFirstMessage = !sessionFirstMessageProcessed.has(input.sessionID)
      sessionFirstMessageProcessed.add(input.sessionID)

      const promptText = extractPromptText(output.parts)
      const messages = detectKeywords(promptText)

      if (messages.length === 0) {
        return
      }

      const context = messages.join("\n")

      // First message: transform parts directly (for title generation compatibility)
      if (isFirstMessage) {
        log(`Keywords detected on first message, transforming parts directly`, { sessionID: input.sessionID, keywordCount: messages.length })
        const idx = output.parts.findIndex((p) => p.type === "text" && p.text)
        if (idx >= 0) {
          output.parts[idx].text = `${context}\n\n---\n\n${output.parts[idx].text ?? ""}`
        }
        return
      }

      // Subsequent messages: inject as separate message
      log(`Keywords detected: ${messages.length}`, { sessionID: input.sessionID })

      const message = output.message as {
        agent?: string
        model?: { modelID?: string; providerID?: string }
        path?: { cwd?: string; root?: string }
        tools?: Record<string, boolean>
      }

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
