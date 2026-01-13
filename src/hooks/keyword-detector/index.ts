import type { PluginInput } from "@opencode-ai/plugin"
import { detectKeywordsWithType, extractPromptText, removeCodeBlocks } from "./detector"
import { log } from "../../shared"
import { getMainSessionID } from "../../features/claude-code-session-state"
import type { ContextCollector } from "../../features/context-injector"

export * from "./detector"
export * from "./constants"
export * from "./types"

export function createKeywordDetectorHook(ctx: PluginInput, collector?: ContextCollector) {
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
      let detectedKeywords = detectKeywordsWithType(removeCodeBlocks(promptText), input.agent)

      if (detectedKeywords.length === 0) {
        return
      }

      const mainSessionID = getMainSessionID()
      const isNonMainSession = mainSessionID && input.sessionID !== mainSessionID

      if (isNonMainSession) {
        detectedKeywords = detectedKeywords.filter((k) => k.type === "ultrawork")
        if (detectedKeywords.length === 0) {
          log(`[keyword-detector] Skipping non-ultrawork keywords in non-main session`, {
            sessionID: input.sessionID,
            mainSessionID,
          })
          return
        }
      }

      const hasUltrawork = detectedKeywords.some((k) => k.type === "ultrawork")
      if (hasUltrawork) {
        log(`[keyword-detector] Ultrawork mode activated`, { sessionID: input.sessionID })

        if (output.message.variant === undefined) {
          output.message.variant = "max"
        }

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

      if (collector) {
        for (const keyword of detectedKeywords) {
          collector.register(input.sessionID, {
            id: `keyword-${keyword.type}`,
            source: "keyword-detector",
            content: keyword.message,
            priority: keyword.type === "ultrawork" ? "critical" : "high",
          })
        }
      }

      log(`[keyword-detector] Detected ${detectedKeywords.length} keywords`, {
        sessionID: input.sessionID,
        types: detectedKeywords.map((k) => k.type),
      })
    },
  }
}
