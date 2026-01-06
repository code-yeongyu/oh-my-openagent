import type { ContextCollector } from "./collector"
import type { Message, Part } from "@opencode-ai/sdk"
import { log } from "../../shared"

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
      _input: ChatMessageInput,
      _output: ChatMessageOutput
    ): Promise<void> => {
      void collector
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
      const sessionID = (lastUserMessage.info as unknown as { sessionID?: string }).sessionID
      log("[DEBUG] Extracted sessionID from lastUserMessage.info", {
        sessionID,
        infoKeys: Object.keys(lastUserMessage.info),
        lastUserMessageInfo: JSON.stringify(lastUserMessage.info).slice(0, 200),
      })
      if (!sessionID) {
        log("[DEBUG] sessionID is undefined or empty")
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

      const refInfo = lastUserMessage.info as unknown as {
        sessionID?: string
        agent?: string
        model?: { providerID?: string; modelID?: string }
        path?: { cwd?: string; root?: string }
      }

      const syntheticMessageId = `synthetic_ctx_${Date.now()}`
      const syntheticPartId = `synthetic_ctx_part_${Date.now()}`
      const now = Date.now()

      const syntheticMessage: MessageWithParts = {
        info: {
          id: syntheticMessageId,
          sessionID: sessionID,
          role: "user",
          time: { created: now },
          agent: refInfo.agent ?? "Sisyphus",
          model: refInfo.model ?? { providerID: "unknown", modelID: "unknown" },
          path: refInfo.path ?? { cwd: "/", root: "/" },
        } as unknown as Message,
        parts: [
          {
            id: syntheticPartId,
            sessionID: sessionID,
            messageID: syntheticMessageId,
            type: "text",
            text: pending.merged,
            synthetic: true,
            time: { start: now, end: now },
          } as Part,
        ],
      }

      messages.splice(lastUserMessageIndex, 0, syntheticMessage)

      log("[context-injector] Injected synthetic message from collector", {
        sessionID,
        insertIndex: lastUserMessageIndex,
        contextLength: pending.merged.length,
        newMessageCount: messages.length,
      })
    },
  }
}
