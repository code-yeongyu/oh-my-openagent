import type { Plugin } from "@opencode/plugin"
import type {
  AssistantMessage,
  Message,
  Part,
  TextPart,
  ToolPart,
  ToolState,
  UserMessage,
} from "@opencode-ai/sdk"

export type V2SessionDomain = Plugin.Context["session"]

export type V2SessionMessage = Awaited<ReturnType<V2SessionDomain["context"]>>[number]

type V2MessageTextPart = { type: "text"; text: string }
type V2MessageToolPart = {
  type: "tool"
  id: string
  name: string
  state: { status: string; input?: unknown }
}

function isTextPart(part: { type: string }): part is V2MessageTextPart {
  return part.type === "text" && typeof (part as { text?: unknown }).text === "string"
}

function isToolPart(part: { type: string }): part is V2MessageToolPart {
  return part.type === "tool" && typeof (part as { name?: unknown }).name === "string"
}

function readPartText(part: { type: string }): string | undefined {
  if (part.type === "reasoning") return undefined
  if (isTextPart(part)) return part.text
  return undefined
}

function toolStateFromV2(status: string, input: unknown): ToolState {
  const record = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>
  switch (status) {
    case "completed":
      return { status: "completed", input: record, output: "", title: "", metadata: {}, time: { start: 0, end: 0 } }
    case "error":
      return { status: "error", input: record, error: "unknown tool error", time: { start: 0, end: 0 } }
    case "running":
      return { status: "running", input: record, time: { start: 0 } }
    default:
      return { status: "pending", input: record, raw: "" }
  }
}

function userInfo(message: Extract<V2SessionMessage, { type: "user" }>, sessionID: string): UserMessage {
  return {
    id: message.id,
    sessionID,
    role: "user",
    time: { created: message.time.created },
    agent: "",
    model: { providerID: "", modelID: "" },
  }
}

function assistantInfo(
  message: Extract<V2SessionMessage, { type: "assistant" }>,
  sessionID: string,
): AssistantMessage {
  const tokens = message.tokens
  return {
    id: message.id,
    sessionID,
    role: "assistant",
    time: { created: message.time.created, completed: message.time.completed },
    parentID: "",
    modelID: message.model?.id ?? "",
    providerID: message.model?.providerID ?? "",
    mode: "",
    path: { cwd: "", root: "" },
    cost: message.cost ?? 0,
    tokens: {
      input: tokens?.input ?? 0,
      output: tokens?.output ?? 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
}

function systemInfo(
  message: Extract<V2SessionMessage, { type: "system" | "synthetic" | "skill" }>,
  sessionID: string,
): UserMessage {
  return {
    id: message.id,
    sessionID,
    role: "user",
    time: { created: message.time.created },
    agent: "",
    model: { providerID: "", modelID: "" },
  }
}

export interface V1MessageView {
  info: Message
  parts: Part[]
}

export function toV1MessageViews(messages: V2SessionMessage[], sessionID: string): V1MessageView[] {
  const views: V1MessageView[] = []
  for (const message of messages) {
    if (message.type === "user") {
      const parts: Part[] = []
      const text = message.text ?? ""
      if (text) {
        parts.push({ id: message.id, sessionID, messageID: message.id, type: "text", text } as TextPart)
      }
      views.push({ info: userInfo(message, sessionID), parts })
      continue
    }
    if (message.type === "assistant") {
      const parts: Part[] = []
      for (const content of message.content ?? []) {
        const text = readPartText(content)
        if (text !== undefined) {
          parts.push({ id: message.id, sessionID, messageID: message.id, type: "text", text } as TextPart)
          continue
        }
        if (isToolPart(content)) {
          const state = content.state ?? { status: "pending" }
          parts.push({
            id: content.id,
            sessionID,
            messageID: message.id,
            type: "tool",
            callID: content.id,
            tool: content.name,
            state: toolStateFromV2(state.status, state.input),
          } as ToolPart)
        }
      }
      views.push({ info: assistantInfo(message, sessionID), parts })
      continue
    }
    if (message.type === "system" || message.type === "synthetic" || message.type === "skill") {
      const text = message.text ?? ""
      const parts: Part[] = text
        ? [{ id: message.id, sessionID, messageID: message.id, type: "text", text } as TextPart]
        : []
      views.push({ info: systemInfo(message, sessionID), parts })
      continue
    }
    if (message.type === "compaction") {
      const summary = "summary" in message && typeof message.summary === "string" ? message.summary : ""
      const parts: Part[] = summary
        ? [{ id: message.id, sessionID, messageID: message.id, type: "text", text: summary } as TextPart]
        : []
      views.push({ info: systemInfo({ ...message, text: summary } as never, sessionID), parts })
      continue
    }
  }
  return views
}

export function extractV1Text(parts: Part[] | undefined): string {
  if (!parts) return ""
  const texts: string[] = []
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string" && !part.synthetic) texts.push(part.text)
  }
  return texts.join("\n")
}

export function lastAssistantAgent(messages: V2SessionMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.type === "assistant") return message.agent || undefined
  }
  return undefined
}
