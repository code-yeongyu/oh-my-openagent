import type { HostKind } from "../host-contract"
import { detectKeywordsWithType, looksLikeSlashCommand } from "../hooks/keyword-detector/detector"

type TargetInputEvent = {
  text: string
  images?: unknown[]
  source: "interactive" | "rpc" | "extension"
}

type TargetBeforeAgentStartEvent = {
  prompt: string
  systemPrompt: string | string[]
}

type TargetContextEvent = {
  messages: unknown[]
}

type TargetMessageTransformEvent = "input" | "before_agent_start" | "context"

export type TargetMessageTransformApi = {
  on(
    event: TargetMessageTransformEvent,
    handler: (payload: unknown, context: unknown) => unknown | Promise<unknown>,
  ): void
}

export type TargetMessageValidationReport = {
  assistantMessages: number
  thinkingBlocks: number
  toolCalls: number
  toolResults: number
  missingToolResults: string[]
}

const TARGET_MODE_SYSTEM_PROMPT =
  "Honor Oh My OpenAgent mode blocks embedded in the user prompt as operational instructions for this turn."

const MODE_MARKERS = ["<ultrawork-mode>", "[search-mode]", "[analyze-mode]", "[team-mode]"] as const
const TARGET_KEYWORD_TYPES = ["ultrawork", "search", "analyze", "team"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function alreadyInjected(text: string): boolean {
  return MODE_MARKERS.some((marker) => text.includes(marker))
}

export function injectTargetKeywordMessages(text: string): string {
  if (looksLikeSlashCommand(text) || alreadyInjected(text)) return text
  const detected = detectKeywordsWithType(text, undefined, undefined, undefined, TARGET_KEYWORD_TYPES)
  if (detected.length === 0) return text
  return `${detected.map(({ message }) => message).join("\n\n")}\n\n${text}`
}

function appendSystemPrompt(host: Exclude<HostKind, "opencode">, systemPrompt: string | string[]): string | string[] {
  if (host === "oh-my-pi") {
    const prompts = Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt]
    return prompts.includes(TARGET_MODE_SYSTEM_PROMPT) ? prompts : [...prompts, TARGET_MODE_SYSTEM_PROMPT]
  }
  const prompt = Array.isArray(systemPrompt) ? systemPrompt.join("\n\n") : systemPrompt
  return prompt.includes(TARGET_MODE_SYSTEM_PROMPT)
    ? prompt
    : `${prompt}\n\n${TARGET_MODE_SYSTEM_PROMPT}`
}

function contentParts(message: Record<string, unknown>): unknown[] {
  return Array.isArray(message.content) ? message.content : []
}

function transformUserMessage(message: unknown): unknown {
  if (!isRecord(message) || message.role !== "user") return message

  if (typeof message.content === "string") {
    const content = injectTargetKeywordMessages(message.content)
    return content === message.content ? message : { ...message, content }
  }

  if (!Array.isArray(message.content)) return message
  let changed = false
  const content = message.content.map((part) => {
    if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return part
    const text = injectTargetKeywordMessages(part.text)
    if (text === part.text) return part
    changed = true
    return { ...part, text }
  })
  return changed ? { ...message, content } : message
}

export function injectTargetKeywordMessagesIntoContext(messages: readonly unknown[]): unknown[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const transformed = transformUserMessage(messages[index])
    if (transformed === messages[index]) continue
    const next = [...messages]
    next[index] = transformed
    return next
  }
  return [...messages]
}

export function validateTargetMessages(messages: readonly unknown[]): TargetMessageValidationReport {
  const toolCallIDs = new Set<string>()
  const toolResultIDs = new Set<string>()
  let assistantMessages = 0
  let thinkingBlocks = 0

  for (const message of messages) {
    if (!isRecord(message)) continue
    if (message.role === "assistant") {
      assistantMessages += 1
      for (const part of contentParts(message)) {
        if (!isRecord(part)) continue
        if (part.type === "thinking") thinkingBlocks += 1
        if (part.type === "toolCall" && typeof part.id === "string") toolCallIDs.add(part.id)
      }
    }
    if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      toolResultIDs.add(message.toolCallId)
    }
  }

  return {
    assistantMessages,
    thinkingBlocks,
    toolCalls: toolCallIDs.size,
    toolResults: toolResultIDs.size,
    missingToolResults: [...toolCallIDs].filter((id) => !toolResultIDs.has(id)),
  }
}

export function registerTargetMessageTransforms(
  host: Exclude<HostKind, "opencode">,
  api: TargetMessageTransformApi,
): void {
  api.on("input", (payload) => {
    if (!isRecord(payload) || typeof payload.text !== "string") return undefined
    const event = payload as TargetInputEvent
    const text = injectTargetKeywordMessages(event.text)
    if (text === event.text) return undefined
    if (host === "pi") return { action: "transform", text, images: event.images }
    return { text, images: event.images }
  })

  api.on("before_agent_start", (payload) => {
    if (!isRecord(payload) || typeof payload.prompt !== "string") return undefined
    if (!alreadyInjected(payload.prompt) && injectTargetKeywordMessages(payload.prompt) === payload.prompt) return undefined
    const event = payload as TargetBeforeAgentStartEvent
    return { systemPrompt: appendSystemPrompt(host, event.systemPrompt) }
  })

  api.on("context", (payload) => {
    if (!isRecord(payload) || !Array.isArray(payload.messages)) return undefined
    const event = payload as TargetContextEvent
    validateTargetMessages(event.messages)
    return { messages: injectTargetKeywordMessagesIntoContext(event.messages) }
  })
}
