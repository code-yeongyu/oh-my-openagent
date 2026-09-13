// From raw hook payloads and the branch snapshot to the fields of one KibitzerEvent. Every reader
// here is tolerant: a malformed payload yields `undefined` and the stream records nothing.

import { EXCLUDED_CUSTOM_TYPES, textOf } from "../recall-session-read"

const IDENTIFIER_MAX_CHARS = 64
const UNSERIALIZABLE_INPUT = "[unserializable tool input]"

export function promptText(payload: unknown): string | undefined {
  const text = typeof payload === "string" ? payload : isRecord(payload) && typeof payload.prompt === "string" ? payload.prompt : undefined
  if (text === undefined) return undefined
  const trimmed = text.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

export function toolCallOf(payload: unknown): { readonly tool: string; readonly callId?: string; readonly input: Record<string, unknown> } | undefined {
  if (!isRecord(payload) || typeof payload.toolName !== "string" || !isRecord(payload.input)) return undefined
  const callId = identifier(payload.toolCallId)
  return { tool: identifier(payload.toolName) ?? payload.toolName, ...(callId === undefined ? {} : { callId }), input: payload.input }
}

export function toolResultOf(payload: unknown): { readonly tool: string; readonly callId?: string; readonly text: string; readonly isError: boolean } | undefined {
  if (!isRecord(payload) || typeof payload.toolName !== "string") return undefined
  const callId = identifier(payload.toolCallId)
  return {
    tool: identifier(payload.toolName) ?? payload.toolName,
    ...(callId === undefined ? {} : { callId }),
    text: resultText(payload.content),
    isError: payload.isError === true,
  }
}

/** `eval.summary` when present, otherwise the code head; every other tool gets its compact JSON input. */
export function toolArgsText(tool: string, input: Record<string, unknown>): string {
  if (tool === "eval") {
    if (typeof input.summary === "string" && input.summary.trim().length > 0) return input.summary.trim()
    if (typeof input.code === "string") return input.code
  }
  try {
    return JSON.stringify(input) ?? UNSERIALIZABLE_INPUT
  } catch {
    return UNSERIALIZABLE_INPUT
  }
}

function resultText(content: unknown): string {
  const text = textOf(content).trim()
  if (text.length > 0 || !Array.isArray(content)) return text
  const images = content.filter((block) => isRecord(block) && block.type === "image").length
  return images === 0 ? "" : `[${images} image${images === 1 ? "" : "s"}]`
}

export function newestAssistant(branch: readonly unknown[]): { readonly index: number; readonly text: string } | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (!isRecord(entry) || entry.type !== "message") continue
    const message = entry.message
    if (!isRecord(message) || message.role !== "assistant") continue
    if (typeof message.customType === "string" && EXCLUDED_CUSTOM_TYPES.has(message.customType)) continue
    return { index, text: textOf(message.content).trim() }
  }
  return undefined
}

function identifier(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  return value.length > IDENTIFIER_MAX_CHARS ? value.slice(0, IDENTIFIER_MAX_CHARS) : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
