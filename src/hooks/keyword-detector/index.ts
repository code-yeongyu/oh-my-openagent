import type { PluginInput } from "@opencode-ai/plugin"
import { detectKeywordsWithType, extractPromptText, removeCodeBlocks } from "./detector"
import { log } from "../../shared"

export * from "./detector"
export * from "./constants"
export * from "./types"

export function createKeywordDetectorHook(ctx: PluginInput) {
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
      const detectedKeywords = detectKeywordsWithType(removeCodeBlocks(promptText))

      if (detectedKeywords.length === 0) {
        return
      }

      const hasUltrawork = detectedKeywords.some((k) => k.type === "ultrawork")
      if (hasUltrawork) {
        log(`[keyword-detector] Ultrawork mode activated`, { sessionID: input.sessionID })

        ctx.client.tui
          .showToast({
            body: {
              title: "Ultrawork Mode Activated",
              message: "Maximum precision engaged. All agents at your disposal.",
              variant: "success" as const,
              duration: 3000,
            },
          })
          .catch((err) =>
            log(`[keyword-detector] Failed to show toast`, { error: err, sessionID: input.sessionID })
          )
      }

      log(`[keyword-detector] Detected ${detectedKeywords.length} keywords`, {
        sessionID: input.sessionID,
        types: detectedKeywords.map((k) => k.type),
      })
    },
  }
}
