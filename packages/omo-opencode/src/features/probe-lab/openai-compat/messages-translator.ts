import { log } from "../../../shared/logger"
import type {
  ChatCompletionRequest,
  ChatContentPartImage,
  ChatContentPartText,
  ChatMessageToolCall,
} from "./schemas"
import {
  formatAssistantToolCallsAsDsml,
  formatToolResultAsDsml,
} from "./tool-calls/history"

type ChatMessage = ChatCompletionRequest["messages"][number]
type MessageContent = ChatMessage["content"]
type ContentPart = ReadonlyArray<unknown>[number]

export type ImageUploader = (input: {
  data: Uint8Array
  mimeType: string
  filename: string
}) => Promise<{ ok: true; fileId: string } | { ok: false; reason: string }>

export type TranslationResult =
  | { ok: true; prompt: string; ref_file_ids: ReadonlyArray<string> }
  | { ok: false; reason: string }

const SUPPORTED_ROLES: ReadonlySet<string> = new Set([
  "system",
  "user",
  "assistant",
  "tool",
])

const DATA_URL_RE = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s

function asToolCalls(value: unknown): ChatMessageToolCall[] | null {
  if (!Array.isArray(value)) return null
  const out: ChatMessageToolCall[] = []
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue
    const obj = item as Record<string, unknown>
    const fn = obj.function as Record<string, unknown> | undefined
    if (
      typeof obj.id !== "string" ||
      obj.type !== "function" ||
      !fn ||
      typeof fn.name !== "string" ||
      typeof fn.arguments !== "string"
    ) {
      continue
    }
    out.push({
      id: obj.id,
      type: "function",
      function: { name: fn.name, arguments: fn.arguments },
    })
  }
  return out
}

function readReasoningContent(raw: Record<string, unknown>): string {
  const value = raw.reasoning_content
  return typeof value === "string" ? value : ""
}

function isTextPart(part: unknown): part is ChatContentPartText {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  )
}

function isImagePart(part: unknown): part is ChatContentPartImage {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "image_url"
  )
}

function readImageUrl(part: ChatContentPartImage): string | null {
  const url = part.image_url
  if (typeof url === "string") return url
  if (url && typeof url === "object" && typeof url.url === "string") return url.url
  return null
}

function decodeDataUrl(url: string): { data: Uint8Array; mimeType: string } | null {
  const match = DATA_URL_RE.exec(url)
  if (!match) return null
  const mimeType = match[1] ?? "application/octet-stream"
  const payload = match[2] ?? ""
  const isBase64 = url.slice(0, match[0].indexOf(",")).includes(";base64")
  try {
    const data = isBase64
      ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload))
    return { data, mimeType }
  } catch {
    return null
  }
}

function inferFilename(mimeType: string, index: number): string {
  const ext = mimeType.split("/")[1]?.split("+")[0] ?? "bin"
  return `image-${index}.${ext}`
}

type CollectedContent = { text: string; refFileIds: string[] }

async function collectContentParts(
  parts: ReadonlyArray<ContentPart>,
  uploader: ImageUploader | undefined,
  requestId: string,
): Promise<{ ok: true; data: CollectedContent } | { ok: false; reason: string }> {
  const out: CollectedContent = { text: "", refFileIds: [] }
  let imageIndex = 0
  for (const part of parts) {
    if (isTextPart(part)) {
      if (out.text.length > 0) out.text += "\n"
      out.text += part.text
      continue
    }
    if (!isImagePart(part)) continue
    const url = readImageUrl(part)
    if (!url) continue
    if (url.startsWith("data:")) {
      const decoded = decodeDataUrl(url)
      if (!decoded) {
        return { ok: false, reason: "image_url data URL could not be decoded" }
      }
      if (!uploader) {
        log(`openai-compat-translator: image part dropped, no uploader [rid=${requestId}]`)
        continue
      }
      imageIndex += 1
      const filename = inferFilename(decoded.mimeType, imageIndex)
      const result = await uploader({ data: decoded.data, mimeType: decoded.mimeType, filename })
      if (!result.ok) return { ok: false, reason: `image upload failed: ${result.reason}` }
      out.refFileIds.push(result.fileId)
      continue
    }
    return {
      ok: false,
      reason: "remote image URLs not yet supported, use data: URL with base64",
    }
  }
  return { ok: true, data: out }
}

async function renderUserOrSystemMessage(
  m: ChatMessage,
  uploader: ImageUploader | undefined,
  requestId: string,
): Promise<{ ok: true; line: string; refFileIds: ReadonlyArray<string> } | { ok: false; reason: string }> {
  const content = m.content as MessageContent
  if (typeof content === "string" || content == null) {
    const text = typeof content === "string" ? content : ""
    return { ok: true, line: `[${m.role}]: ${text}`, refFileIds: [] }
  }
  if (!Array.isArray(content)) {
    return { ok: true, line: `[${m.role}]: `, refFileIds: [] }
  }
  const parts = await collectContentParts(content, uploader, requestId)
  if (!parts.ok) return parts
  return { ok: true, line: `[${m.role}]: ${parts.data.text}`, refFileIds: parts.data.refFileIds }
}

function renderAssistantMessage(m: ChatMessage): string {
  const raw = m as unknown as Record<string, unknown>
  const content = typeof m.content === "string" ? m.content : ""
  const reasoning = readReasoningContent(raw)
  const reasoningPrefix = reasoning.length > 0 ? `[reasoning]: ${reasoning}\n` : ""
  const toolCalls = asToolCalls(raw.tool_calls)
  if (!toolCalls || toolCalls.length === 0) {
    return `${reasoningPrefix}[assistant]: ${content}`
  }
  const dsml = formatAssistantToolCallsAsDsml(toolCalls)
  if (content.length === 0) {
    return `${reasoningPrefix}[assistant]:\n${dsml}`
  }
  return `${reasoningPrefix}[assistant]: ${content}\n${dsml}`
}

function renderToolMessage(
  m: ChatMessage,
): { ok: true; line: string } | { ok: false; reason: string } {
  const raw = m as unknown as Record<string, unknown>
  const toolCallId = typeof raw.tool_call_id === "string" ? raw.tool_call_id : ""
  if (toolCallId.length === 0) {
    return {
      ok: false,
      reason: 'tool message missing required "tool_call_id" field',
    }
  }
  const content = typeof m.content === "string" ? m.content : ""
  const name = typeof raw.name === "string" ? raw.name : undefined
  const dsml = formatToolResultAsDsml({
    tool_call_id: toolCallId,
    name,
    content,
  })
  return { ok: true, line: `[tool]:\n${dsml}` }
}

export async function translateMessages(
  messages: ReadonlyArray<ChatMessage>,
  uploader?: ImageUploader,
  requestId = "anon",
): Promise<TranslationResult> {
  if (messages.length === 0) {
    return { ok: false, reason: "messages array is empty" }
  }
  const parts: string[] = []
  const refFileIds: string[] = []
  for (const m of messages) {
    if (m.role === "function") {
      return {
        ok: false,
        reason: '"function" role is not supported (legacy); use role "tool"',
      }
    }
    if (!SUPPORTED_ROLES.has(m.role)) {
      return { ok: false, reason: `unknown role "${m.role}"` }
    }
    if (m.role === "assistant") {
      parts.push(renderAssistantMessage(m))
      continue
    }
    if (m.role === "tool") {
      const r = renderToolMessage(m)
      if (!r.ok) return { ok: false, reason: r.reason }
      parts.push(r.line)
      continue
    }
    const rendered = await renderUserOrSystemMessage(m, uploader, requestId)
    if (!rendered.ok) return { ok: false, reason: rendered.reason }
    parts.push(rendered.line)
    refFileIds.push(...rendered.refFileIds)
  }
  return { ok: true, prompt: parts.join("\n\n"), ref_file_ids: refFileIds }
}
