// Session-shaped reads for the memorian recall channel: the live ctx snapshot, the
// planner's user-only window, and the judge's dual-role transcript. Memory-owned
// hidden channels are excluded so a previous hint cannot re-enter the query.

import { MEMORY_NOTICE_CUSTOM_TYPE } from "./prompt"

export const RECALL_CUSTOM_TYPE = "omo-memorian:recall"

/** Newest conversation texts feeding the query planner; older turns are not what the user is on. */
export const RECALL_TEXT_WINDOW = 6

// Memory-owned hidden channels. Their content is derived FROM memory, so feeding them back into
// the query planner would make recall search for the hint it just injected.
export const EXCLUDED_CUSTOM_TYPES: ReadonlySet<string> = new Set([RECALL_CUSTOM_TYPE, MEMORY_NOTICE_CUSTOM_TYPE])

/** One line of the judge's transcript window: both roles, oldest first. */
export interface RecallTranscriptTurn {
  readonly role: "user" | "assistant"
  readonly text: string
}

/**
 * The ctx-derived half of a settle, read synchronously while the ctx is still alive. The memorian
 * gate detaches its launch, and the host disposes the ctx as soon as the settle handler returns, so
 * the gate captures this first and the async work consumes only these plain values.
 */
export interface RecallSessionSnapshot {
  readonly id: string
  readonly entries: readonly unknown[]
}

export interface RecallSession {
  readonly id: string
  readonly entries: readonly unknown[]
}

/**
 * The judge's window, oldest first: both roles, memory-owned hidden channels excluded for the same
 * reason the planner excludes them - a previous hint is not conversation.
 */
export function judgeTranscript(entries: readonly unknown[]): RecallTranscriptTurn[] {
  const turns: RecallTranscriptTurn[] = []
  for (let index = entries.length - 1; index >= 0 && turns.length < RECALL_TEXT_WINDOW; index -= 1) {
    const turn = judgeTurn(entries[index])
    if (turn !== undefined) turns.push(turn)
  }
  return turns.reverse()
}

function judgeTurn(entry: unknown): RecallTranscriptTurn | undefined {
  if (!isRecord(entry)) return undefined
  if (entry.type !== "message") return undefined
  const message = entry.message
  if (!isRecord(message)) return undefined
  if (message.role !== "user" && message.role !== "assistant") return undefined
  if (typeof message.customType === "string" && EXCLUDED_CUSTOM_TYPES.has(message.customType)) return undefined
  const text = textOf(message.content)
  if (text.trim().length === 0) return undefined
  return { role: message.role, text }
}

export function readSession(eventCtx: unknown): RecallSession | undefined {
  if (!isRecord(eventCtx)) return undefined
  const manager = eventCtx.sessionManager
  if (!isRecord(manager)) return undefined
  const getSessionId = manager.getSessionId
  const getBranch = manager.getBranch
  if (typeof getSessionId !== "function" || typeof getBranch !== "function") return undefined
  const id = Reflect.apply(getSessionId, manager, [])
  const entries = Reflect.apply(getBranch, manager, [])
  if (typeof id !== "string" || id.length === 0 || !Array.isArray(entries)) return undefined
  return { id, entries }
}

/**
 * Newest-first USER texts for the planner. Memory-owned hidden custom messages are skipped: senpi
 * persists an injected recall block as a `custom_message` branch entry, so an unfiltered window
 * would rediscover the previous hint instead of the live conversation.
 */
export function userTexts(entries: readonly unknown[]): string[] {
  const texts: string[] = []
  for (let index = entries.length - 1; index >= 0 && texts.length < RECALL_TEXT_WINDOW; index -= 1) {
    const text = userText(entries[index])
    if (text !== undefined) texts.push(text)
  }
  return texts
}

function userText(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined
  if (entry.type === "custom_message" || entry.type === "custom") return undefined
  if (entry.type !== "message") return undefined
  const message = entry.message
  if (!isRecord(message)) return undefined
  if (message.role !== "user") return undefined
  if (typeof message.customType === "string" && EXCLUDED_CUSTOM_TYPES.has(message.customType)) return undefined
  const text = textOf(message.content)
  return text.trim().length === 0 ? undefined : text
}

export function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text") continue
    if (typeof block.text === "string") parts.push(block.text)
  }
  return parts.join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
