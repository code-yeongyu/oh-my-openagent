import type { Message, Part } from "@opencode-ai/sdk"
import { log } from "../../shared"
import { isSystemDirective, removeSystemReminders } from "../../shared/system-directive"
import { classifyTaskComplexity } from "./classifier"
import { getDevinAutoDelegateMessage } from "./message"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

function extractTextFromParts(parts: Part[]): string {
  return parts
    .filter((p) => p.type === "text" && "text" in p)
    .map((p) => (p as { text: string }).text)
    .join("\n")
    .trim()
}

function looksLikeSlashCommand(text: string): boolean {
  return /^\//.test(text.trim())
}

function isSimpleTaskSession(messages: MessageWithParts[]): boolean {
  // Only trigger when there's exactly 1 user message (first message of session)
  const userMessages = messages.filter((m) => m.info.role === "user")
  return userMessages.length === 1
}

export function createDevinAutoDelegateHook(enabled: boolean) {
  if (!enabled) {
    return null
  }

  return {
    "experimental.chat.messages.transform": async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] }
    ): Promise<void> => {
      const { messages } = output
      if (!messages || messages.length === 0) {
        return
      }

      // Find the last user message
      const lastUserMsgIndex = messages.findLastIndex((m) => m.info.role === "user")
      if (lastUserMsgIndex === -1) return

      const lastUserMsg = messages[lastUserMsgIndex]
      const promptText = extractTextFromParts(lastUserMsg.parts)

      if (isSystemDirective(promptText)) {
        return
      }

      if (looksLikeSlashCommand(promptText)) {
        return
      }

      // Only auto-delegate on the very first user message
      if (!isSimpleTaskSession(messages)) {
        return
      }

      const cleanText = removeSystemReminders(promptText)
      const complexity = classifyTaskComplexity(cleanText)

      if (complexity === "simple") {
        log(`[devin-auto-delegate] Simple task detected, injecting delegation instruction`, {
          taskPreview: cleanText.slice(0, 100),
        })

        // Inject a user-like instruction message before the last user message
        // We use role "user" so the agent treats it as a directive from the system
        const injectionMessage: MessageWithParts = {
          info: {
            id: "devin-auto-delegate-instruction",
            role: "user",
            sessionID: lastUserMsg.info.sessionID,
            time: { created: Date.now() },
          } as unknown as Message,
          parts: [
            {
              type: "text",
              text: getDevinAutoDelegateMessage(cleanText),
            } as Part,
          ],
        }

        // Insert before the last user message
        messages.splice(lastUserMsgIndex, 0, injectionMessage)
      } else if (complexity === "complex") {
        log(`[devin-auto-delegate] Complex task detected, letting Sisyphus handle it`, {
          taskPreview: cleanText.slice(0, 100),
        })
      }
    },
  }
}
