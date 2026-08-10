// Senpi session events -> transcript journal wiring (plan todo 21).
// agent_settled is the authoritative branch-delta scan; session_start reconciles
// entries missed after crashes or downtime. message_end never writes; turn_end is
// unused. Row shapes and idempotency live in memory-core (projectTranscriptEntries,
// TranscriptJournal keyed by source_line_id); this module maps persisted senpi
// branch entries onto TranscriptProjection and joins tool results into their tool
// calls by toolCallId. Journals live at <identity runtime>/transcripts/<sessionId>/.

import { join } from "node:path"

import {
  TranscriptJournal,
  type AppendResult,
  type MemoryIdentityPaths,
  type ProjectedReasoning,
  type ProjectedToolCall,
  type TranscriptProjection,
} from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../extension/types"

export interface MemoryJournalWiringOptions {
  readonly identityPaths: MemoryIdentityPaths
  readonly createJournal?: (journalDir: string) => TranscriptJournal
}

export interface MemoryJournalWiring {
  register(pi: SenpiExtensionAPI): void
  journalFor(sessionId: string): TranscriptJournal
  reconcileSession(eventCtx: unknown): Promise<AppendResult>
}

const NOOP_APPEND: AppendResult = { appended: 0, skipped: 0 }

export function createMemoryJournalWiring(options: MemoryJournalWiringOptions): MemoryJournalWiring {
  const createJournal =
    options.createJournal ?? ((journalDir: string) => new TranscriptJournal({ journalDir }))
  const journals = new Map<string, TranscriptJournal>()

  function journalFor(sessionId: string): TranscriptJournal {
    const cached = journals.get(sessionId)
    if (cached !== undefined) return cached
    const journal = createJournal(join(options.identityPaths.transcripts, sessionId))
    journals.set(sessionId, journal)
    return journal
  }

  async function reconcileSession(eventCtx: unknown): Promise<AppendResult> {
    const surface = readBranchSurface(eventCtx)
    if (surface === undefined) return NOOP_APPEND
    return journalFor(surface.sessionId).reconcile(projectSessionEntries(surface.entries))
  }

  return {
    journalFor,
    reconcileSession,
    register(pi) {
      pi.on("session_start", (_payload, eventCtx) => reconcileSession(eventCtx))
      pi.on("agent_settled", (_payload, eventCtx) => reconcileSession(eventCtx))
    },
  }
}

interface BranchSurface {
  readonly sessionId: string
  readonly entries: readonly unknown[]
}

function readBranchSurface(eventCtx: unknown): BranchSurface | undefined {
  if (!isRecord(eventCtx)) return undefined
  const manager = eventCtx.sessionManager
  if (!isRecord(manager)) return undefined
  const getBranch = manager.getBranch
  const getSessionId = manager.getSessionId
  if (typeof getBranch !== "function" || typeof getSessionId !== "function") return undefined
  const entries: unknown = Reflect.apply(getBranch, manager, [])
  const sessionId: unknown = Reflect.apply(getSessionId, manager, [])
  if (!Array.isArray(entries) || typeof sessionId !== "string" || sessionId.length === 0) {
    return undefined
  }
  return { sessionId, entries }
}

interface SessionMessage {
  readonly id: string
  readonly role: string
  readonly body: Record<string, unknown>
}

export function projectSessionEntries(entries: readonly unknown[]): TranscriptProjection[] {
  const toolResults = new Map<string, { readonly resultText: string; readonly resultOk: boolean }>()
  for (const entry of entries) {
    const message = sessionMessageOf(entry)
    if (message === undefined || message.role !== "toolResult") continue
    const toolCallId = stringOf(message.body.toolCallId)
    if (toolCallId === undefined) continue
    toolResults.set(toolCallId, {
      resultText: textBlocksOf(message.body.content).join("\n"),
      resultOk: message.body.isError !== true,
    })
  }

  const projections: TranscriptProjection[] = []
  for (const entry of entries) {
    const message = sessionMessageOf(entry)
    if (message === undefined) continue
    if (message.role === "user") {
      projections.push({ kind: "user", messageId: message.id, text: userTextOf(message.body.content) })
      continue
    }
    if (message.role !== "assistant") continue
    projections.push(assistantProjection(message.id, message.body, toolResults))
    const errorMessage = stringOf(message.body.errorMessage)
    if (errorMessage !== undefined && errorMessage.trim().length > 0) {
      projections.push({ kind: "error", messageId: message.id, text: errorMessage })
    }
  }
  return projections
}

function sessionMessageOf(entry: unknown): SessionMessage | undefined {
  if (!isRecord(entry) || entry.type !== "message") return undefined
  const id = stringOf(entry.id)
  if (id === undefined) return undefined
  const body = entry.message
  if (!isRecord(body)) return undefined
  const role = stringOf(body.role)
  if (role === undefined) return undefined
  return { id, role, body }
}

function assistantProjection(
  messageId: string,
  body: Record<string, unknown>,
  toolResults: ReadonlyMap<string, { readonly resultText: string; readonly resultOk: boolean }>,
): TranscriptProjection {
  const content = body.content
  const textBlocks: string[] = typeof content === "string" && content.trim().length > 0
    ? [content]
    : textBlocksOf(content)
  const reasoningBlocks: ProjectedReasoning[] = []
  const toolCalls: ProjectedToolCall[] = []
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue
      if (block.type === "thinking") {
        if (block.redacted === true) {
          reasoningBlocks.push({ redacted: true })
        } else {
          const thinking = stringOf(block.thinking)
          if (thinking !== undefined) reasoningBlocks.push(thinking)
        }
        continue
      }
      if (block.type !== "toolCall") continue
      const callId = stringOf(block.id)
      if (callId === undefined) continue
      const name = stringOf(block.name)
      const argsText = safeStringify(block.arguments)
      const result = toolResults.get(callId)
      toolCalls.push({
        callId,
        ...(name === undefined ? {} : { name }),
        ...(argsText === undefined ? {} : { argsText }),
        ...(result === undefined
          ? {}
          : { resultText: result.resultText, resultOk: result.resultOk }),
      })
    }
  }
  return { kind: "assistant", messageId, textBlocks, reasoningBlocks, toolCalls }
}

function userTextOf(content: unknown): string {
  if (typeof content === "string") return content
  return textBlocksOf(content).join("\n")
}

function textBlocksOf(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const texts: string[] = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text") continue
    const text = stringOf(block.text)
    if (text !== undefined && text.trim().length > 0) texts.push(text)
  }
  return texts
}

function safeStringify(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? undefined
  } catch {
    return String(value)
  }
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
