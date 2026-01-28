import type { PluginInput } from "@opencode-ai/plugin"
import { detectKeywordsWithType, extractPromptText, removeCodeBlocks } from "./detector"
import { isPlannerAgent } from "./constants"
import { log } from "../../shared"
import { hasSystemReminder, isSystemDirective, removeSystemReminders } from "../../shared/system-directive"
import { getMainSessionID, getSessionAgent, subagentSessions } from "../../features/claude-code-session-state"
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

      if (isSystemDirective(promptText)) {
        log(`[keyword-detector] Skipping system directive message`, { sessionID: input.sessionID })
        return
      }

      const currentAgent = getSessionAgent(input.sessionID) ?? input.agent

      // Remove system-reminder content to prevent automated system messages from triggering mode keywords
      const cleanText = removeSystemReminders(promptText)
      let detectedKeywords = detectKeywordsWithType(removeCodeBlocks(cleanText), currentAgent)

      if (isPlannerAgent(currentAgent)) {
        detectedKeywords = detectedKeywords.filter((k) => k.type !== "ultrawork")
      }

      if (detectedKeywords.length === 0) {
        return
      }

      // Skip keyword detection for background task sessions to prevent mode injection
      // (e.g., [analyze-mode]) which incorrectly triggers Prometheus restrictions
      const isBackgroundTaskSession = subagentSessions.has(input.sessionID)
      if (isBackgroundTaskSession) {
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

      const textPartIndex = output.parts.findIndex((p) => p.type === "text" && p.text !== undefined)
      if (textPartIndex === -1) {
        log(`[keyword-detector] No text part found, skipping injection`, { sessionID: input.sessionID })
        return
      }

      const allMessages = detectedKeywords.map((k) => k.message).join("\n\n")
      const originalText = output.parts[textPartIndex].text ?? ""

      output.parts[textPartIndex].text = `${allMessages}\n\n---\n\n${originalText}`

      log(`[keyword-detector] Detected ${detectedKeywords.length} keywords`, {
        sessionID: input.sessionID,
        types: detectedKeywords.map((k) => k.type),
      })
    },
  }
}
