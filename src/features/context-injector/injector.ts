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
      if (messages.length === 0) {
        log("[context-injector] messages.transform: no messages")
        return
      }

      const lastMessage = messages[messages.length - 1]
      const sessionID = (lastMessage.info as unknown as { sessionID?: string }).sessionID
      if (!sessionID) {
        log("[context-injector] messages.transform: no sessionID on last message")
        return
      }

      const hasPending = collector.hasPending(sessionID)
      log("[context-injector] messages.transform check", {
        sessionID,
        hasPending,
        messageCount: messages.length,
      })

      if (!hasPending) return

      let lastUserMessageIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].info.role === "user") {
          lastUserMessageIndex = i
          break
        }
      }

      if (lastUserMessageIndex === -1) {
        log("[context-injector] messages.transform: no user message found")
        return
      }

      const pending = collector.consume(sessionID)
      if (!pending.hasContent) {
        log("[context-injector] messages.transform: pending was empty")
        return
      }

      const refMessage = messages[lastUserMessageIndex]
      const refInfo = refMessage.info as unknown as {
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

      log("[context-injector] Injected synthetic message", {
        sessionID,
        insertIndex: lastUserMessageIndex,
        contextLength: pending.merged.length,
        newMessageCount: messages.length,
      })
    },
  }
}
