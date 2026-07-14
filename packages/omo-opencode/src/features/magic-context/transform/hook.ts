import type { Database } from "../db/sqlite"
import type { Embedder } from "../embedding/provider"
import type { MagicContextConfig } from "../../../config/schema/magic-context"
import { createMagicContextInjector } from "./injector"

type TransformPart = Record<string, unknown> & {
  type: string
  text?: string
  synthetic?: boolean
}

type MessageWithParts = {
  info: Record<string, unknown> & { role: string; sessionID?: string }
  parts: TransformPart[]
}

export type MagicContextTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] },
  ) => Promise<void>
}

export function createMagicContextTransformHook(
  config: MagicContextConfig | undefined,
  deps: { db: Database; embedder: Embedder } | null,
): MagicContextTransformHook {
  if (!config?.enabled || !deps) {
    return {}
  }

  const resolved = deps
  const injector = createMagicContextInjector(config, resolved.db, resolved.embedder)

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      if (messages.length === 0) return

      const lastUserIndex = findLastUserIndex(messages)
      if (lastUserIndex === -1) return

      const sessionID = resolveSessionID(messages, lastUserIndex)
      if (!sessionID) return

      const textParts = messages[lastUserIndex].parts.filter(
        (p) => p.type === "text" && typeof p.text === "string",
      )
      if (textParts.length === 0) return

      const userContent = textParts.map((p) => p.text ?? "").join("\n")

      const contextStrings = await injector.injectContext({
        messages: [{ role: "user", content: userContent }],
        sessionId: sessionID,
        projectPath: "",
      })

      if (contextStrings.length === 0) return

      const injectedMessage: MessageWithParts = {
        info: { role: "user", sessionID },
        parts: [
          {
            type: "text",
            text: `<magic_context>\n${contextStrings.join("\n\n---\n\n")}\n</magic_context>`,
            synthetic: true,
          },
        ],
      }

      messages.splice(lastUserIndex, 0, injectedMessage)
    },
  }
}

function findLastUserIndex(messages: MessageWithParts[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.info.role === "user") return i
  }
  return -1
}

function resolveSessionID(messages: MessageWithParts[], lastUserIndex: number): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const sid = messages[i]?.info.sessionID
    if (typeof sid === "string" && sid.length > 0) return sid
  }
  return undefined
}
