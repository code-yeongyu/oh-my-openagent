import type { ContextCollector } from "./collector"
import type { Message, Part } from "@opencode-ai/sdk"
import { log } from "../../shared"
import { getMainSessionID } from "../claude-code-session-state"

interface OutputPart {
  type: string
  text?: string
  [key: string]: unknown
}

interface InjectionResult {
  injected: boolean
  contextLength: number
}

export function injectPendingContext(
  collector: ContextCollector,
  sessionID: string,
  parts: OutputPart[]
): InjectionResult {
  if (!collector.hasPending(sessionID)) {
    return { injected: false, contextLength: 0 }
  }

  const textPartIndex = parts.findIndex((p) => p.type === "text" && p.text !== undefined)
  if (textPartIndex === -1) {
    return { injected: false, contextLength: 0 }
  }

  const pending = collector.consume(sessionID)
  const originalText = parts[textPartIndex].text ?? ""
  parts[textPartIndex].text = `${pending.merged}\n\n---\n\n${originalText}`

  return {
    injected: true,
    contextLength: pending.merged.length,
  }
}

interface ChatMessageInput {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
}

interface ChatMessageOutput {
  message: Record<string, unknown>
  parts: OutputPart[]
}

export function createContextInjectorHook(collector: ContextCollector) {
  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageOutput
    ): Promise<void> => {
      const result = injectPendingContext(collector, input.sessionID, output.parts)
      if (result.injected) {
        log("[context-injector] Injected pending context via chat.message", {
          sessionID: input.sessionID,
          contextLength: result.contextLength,
        })
      }
    },
  }
}

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

export function createContextInjectorMessagesTransformHook(
  collector: ContextCollector
): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      log("[DEBUG] experimental.chat.messages.transform called", {
        messageCount: messages.length,
      })
      if (messages.length === 0) {
        return
      }

      let lastUserMessageIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].info.role === "user") {
          lastUserMessageIndex = i
          break
        }
      }

      if (lastUserMessageIndex === -1) {
        log("[DEBUG] No user message found in messages")
        return
      }

      const lastUserMessage = messages[lastUserMessageIndex]
      // Try message.info.sessionID first, fallback to mainSessionID
      const messageSessionID = (lastUserMessage.info as unknown as { sessionID?: string }).sessionID
      const sessionID = messageSessionID ?? getMainSessionID()
      log("[DEBUG] Extracted sessionID", {
        messageSessionID,
        mainSessionID: getMainSessionID(),
        sessionID,
        infoKeys: Object.keys(lastUserMessage.info),
      })
      if (!sessionID) {
        log("[DEBUG] sessionID is undefined (both message.info and mainSessionID are empty)")
        return
      }

      const hasPending = collector.hasPending(sessionID)
      log("[DEBUG] Checking hasPending", {
        sessionID,
        hasPending,
      })
      if (!hasPending) {
        return
      }

      const pending = collector.consume(sessionID)
      if (!pending.hasContent) {
        return
      }

      const textPartIndex = lastUserMessage.parts.findIndex(
        (p) => p.type === "text" && (p as { text?: string }).text
      )

      if (textPartIndex === -1) {
        log("[context-injector] No text part found in last user message, skipping injection", {
          sessionID,
          partsCount: lastUserMessage.parts.length,
        })
        return
      }

      // synthetic part 패턴 (minimal fields)
      const syntheticPart = {
        id: `synthetic_hook_${Date.now()}`,
        messageID: lastUserMessage.info.id,
        sessionID: (lastUserMessage.info as { sessionID?: string }).sessionID ?? "",
        type: "text" as const,
        text: pending.merged,
        synthetic: true,  // UI에서 숨겨짐
      }

      lastUserMessage.parts.splice(textPartIndex, 0, syntheticPart as Part)

      log("[context-injector] Inserted synthetic part with hook content", {
        sessionID,
        contentLength: pending.merged.length,
      })
    },
  }
}
