import { Type, type Static } from "typebox"

import { EXCLUDED_CUSTOM_TYPES, readSession, textOf } from "../../recall-session-read"
import { GATE_ENTRY_TYPE, NUDGED_ENTRY_TYPE } from "../notice"
import type { WakeToolBudget } from "./budget"
import type { KibitzerToolCaps } from "./caps"
import { boundedText, budgeted, okJson, type KibitzerSidecarTool } from "./result"

export const KIBITZER_SESSION_ENTRIES_TOOL_NAME = "session_entries"

/**
 * Custom types the sidecar never sees: the memory-owned hidden channels (a previous hint is not
 * conversation) plus Kibitzer's own audit records, so the sidecar cannot read its own verdicts back.
 */
export const HIDDEN_SESSION_CUSTOM_TYPES: ReadonlySet<string> = new Set([
  ...EXCLUDED_CUSTOM_TYPES,
  NUDGED_ENTRY_TYPE,
  GATE_ENTRY_TYPE,
])

/**
 * The parent-maintained branch snapshot. The parent refreshes it synchronously at every hook while
 * the ctx is alive (the host disposes the ctx when the handler returns); the sidecar tool reads only
 * this plain copy, never the live session manager.
 */
export interface SessionBranchSnapshot {
  refresh(eventCtx: unknown): void
  entries(): readonly unknown[]
}

export function createSessionBranchSnapshot(): SessionBranchSnapshot {
  let entries: readonly unknown[] = []
  return {
    refresh(eventCtx) {
      const session = readSession(eventCtx)
      if (session === undefined) return
      entries = [...session.entries]
    },
    entries: () => entries,
  }
}

export interface SessionEntryRow {
  /** Position in the branch snapshot; pass the last one back as `since` to continue. */
  readonly cursor: number
  readonly type: string
  readonly role?: string
  readonly text?: string
}

export interface SessionEntriesPage {
  readonly entries: readonly SessionEntryRow[]
  /** Cursor to pass as `since` next time; equals the input when nothing new was returned. */
  readonly next_since: number
  /** Hidden entries omitted from this scan (memory channels and Kibitzer records). */
  readonly hidden: number
  readonly truncated: boolean
}

type SessionEntryCaps = Pick<KibitzerToolCaps, "sessionEntries" | "sessionEntryChars">

/** Entries strictly after `since`, hidden types omitted, bounded to `sessionEntries` rows. */
export function sessionEntriesSince(entries: readonly unknown[], since: number, caps: SessionEntryCaps): SessionEntriesPage {
  const rows: SessionEntryRow[] = []
  let hidden = 0
  let nextSince = since
  let truncated = false
  for (let cursor = Math.max(0, Math.floor(since) + 1); cursor < entries.length; cursor += 1) {
    const entry = entries[cursor]
    if (!isRecord(entry) || typeof entry.type !== "string") continue
    if (isHidden(entry)) {
      hidden += 1
      continue
    }
    if (rows.length >= caps.sessionEntries) {
      truncated = true
      break
    }
    rows.push(renderRow(cursor, entry, caps.sessionEntryChars))
    nextSince = cursor
  }
  return { entries: rows, next_since: nextSince, hidden, truncated }
}

function isHidden(entry: Record<string, unknown>): boolean {
  if (entry.type === "custom" || entry.type === "custom_message") {
    return typeof entry.customType === "string" && HIDDEN_SESSION_CUSTOM_TYPES.has(entry.customType)
  }
  if (entry.type === "message" && isRecord(entry.message)) {
    return typeof entry.message.customType === "string" && HIDDEN_SESSION_CUSTOM_TYPES.has(entry.message.customType)
  }
  return false
}

function renderRow(cursor: number, entry: Record<string, unknown>, cap: number): SessionEntryRow {
  const type = entry.type as string
  if (type === "message" && isRecord(entry.message)) {
    const message = entry.message
    const role = typeof message.role === "string" ? message.role : undefined
    const text = boundedText(messageText(message), cap)
    return { cursor, type, ...(role === undefined ? {} : { role }), text }
  }
  if (type === "custom_message") return { cursor, type, text: boundedText(textOf(entry.content), cap) }
  return { cursor, type }
}

function messageText(message: Record<string, unknown>): string {
  const parts: string[] = []
  const text = textOf(message.content)
  if (text.length > 0) parts.push(text)
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== "toolCall") continue
      const name = typeof block.name === "string" ? block.name : "tool"
      parts.push(`[tool ${name}] ${safeJson(block.arguments)}`)
    }
  }
  if (message.role === "toolResult" && typeof message.toolName === "string") parts.unshift(`[result ${message.toolName}]`)
  return parts.join("\n")
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export const KibitzerSessionEntriesParams = Type.Object({
  since: Type.Optional(Type.Integer({ minimum: -1, description: "Cursor of the last entry already seen; -1 (default) starts from the beginning." })),
}, { additionalProperties: false })

export interface KibitzerSessionEntriesToolInput {
  readonly session: Pick<SessionBranchSnapshot, "entries">
  readonly caps: KibitzerToolCaps
  readonly budget: () => WakeToolBudget
}

export function createKibitzerSessionEntriesTool(
  input: KibitzerSessionEntriesToolInput,
): KibitzerSidecarTool<typeof KibitzerSessionEntriesParams> {
  return {
    name: KIBITZER_SESSION_ENTRIES_TOOL_NAME,
    label: "Kibitzer session",
    description: `Read the primary agent's session entries after a cursor (at most ${input.caps.sessionEntries} per call).`,
    parameters: KibitzerSessionEntriesParams,
    execute: budgeted(input.budget, async (params: Static<typeof KibitzerSessionEntriesParams>) =>
      okJson(sessionEntriesSince(input.session.entries(), params.since ?? -1, input.caps))),
  }
}
