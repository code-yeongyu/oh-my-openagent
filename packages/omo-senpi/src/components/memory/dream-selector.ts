import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

import {
  TranscriptJournal,
  captureCursorSnapshot,
  deriveState,
  initialReflectionState,
  isCanonicalEntry,
  searchTranscripts,
  type ReflectionTranscriptState,
  type SearchDocument,
  type TranscriptEntry,
} from "@oh-my-opencode/memory-core"

export interface DreamSelectionMode {
  readonly focus?: string
}

export interface DreamSelectorOptions {
  readonly transcriptsDir: string
  readonly currentConversationId?: string
  readonly autoSelectMax: number
  readonly autoSelectMaxBytes: number
  readonly now: () => Date
}

export {
  packDreamCandidates,
  rankDreamCandidates,
  scoreDreamCandidate,
  type DreamScoreInput,
  type DreamScoreOperands,
  type DreamScoredConversation,
  type DreamSelection,
} from "./dream-scoring"

import {
  compareConversationIds,
  packDreamCandidates,
  rankDreamCandidates,
  scoreDreamCandidate,
  type DreamScoredConversation,
  type DreamSelection,
} from "./dream-scoring"

interface LoadedConversation {
  readonly conversationId: string
  readonly entries: readonly TranscriptEntry[]
  readonly stepsSinceLastSuccessfulReflection: number
  readonly reflectedThroughMessageId?: string
  readonly newestMessageId: string
  readonly lastActivity: string
  readonly totalBytes: number
}

export async function computeUnreflectedVolume(options: DreamSelectorOptions): Promise<number> {
  const conversations = await loadConversations(options.transcriptsDir)
  return conversations.reduce((total, conversation) => total + conversation.totalBytes, 0)
}

export async function selectDreamConversations(
  options: DreamSelectorOptions,
  mode: DreamSelectionMode = {},
): Promise<DreamSelection> {
  return selectLoadedConversations(await loadConversations(options.transcriptsDir), options, mode)
}

export async function selectRecentDreamConversations(
  options: DreamSelectorOptions,
  recentN: number,
  mode: DreamSelectionMode = {},
): Promise<DreamSelection> {
  const recent = (await loadConversations(options.transcriptsDir))
    .sort((left, right) => {
      const activity = Date.parse(right.lastActivity) - Date.parse(left.lastActivity)
      return activity === 0 ? compareConversationIds(left.conversationId, right.conversationId) : activity
    })
    .slice(0, recentN)
  return selectLoadedConversations(recent, options, mode)
}

function selectLoadedConversations(
  conversations: readonly LoadedConversation[],
  options: DreamSelectorOptions,
  mode: DreamSelectionMode,
): DreamSelection {
  const targetBytes = options.autoSelectMaxBytes / options.autoSelectMax
  const now = options.now()
  const candidates = conversations.map((conversation): DreamScoredConversation => {
    const scored = scoreDreamCandidate({
      searchMatchCount: countSearchMatches(conversation, mode.focus),
      stepsSinceLastSuccessfulReflection: conversation.stepsSinceLastSuccessfulReflection,
      lastActivity: conversation.lastActivity,
      distinctSourceCount: new Set(conversation.entries.map((entry) => entry.source_message_id)).size,
      totalBytes: conversation.totalBytes,
      targetBytes,
      isCurrent: conversation.conversationId === options.currentConversationId,
      newestMessageCovered: conversation.reflectedThroughMessageId === conversation.newestMessageId,
      now,
    })
    return {
      conversationId: conversation.conversationId,
      totalBytes: conversation.totalBytes,
      lastActivityMs: Date.parse(conversation.lastActivity),
      ...scored,
    }
  })
  return packDreamCandidates(rankDreamCandidates(candidates), {
    maxConversations: options.autoSelectMax,
    maxBytes: options.autoSelectMaxBytes,
  })
}

async function loadConversations(transcriptsDir: string): Promise<LoadedConversation[]> {
  const entries = await readdir(transcriptsDir, { withFileTypes: true }).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return []
    throw error
  })
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(compareConversationIds)
  const conversations = await Promise.all(names.map(async (conversationId): Promise<LoadedConversation | null> => {
    const journalDir = join(transcriptsDir, conversationId)
    // Snapshot read (lock-free, torn-tail tolerant): this scan walks EVERY journal of the
    // identity, so taking each state.lock here starved active sessions' reconciles and the
    // shutdown drain that share those locks.
    const journalEntries = await new TranscriptJournal({ journalDir }).readEntriesSnapshot()
    const state = await readReflectionState(join(journalDir, "state.json"), journalEntries)
    const snapshot = captureCursorSnapshot(journalEntries, state)
    const newest = journalEntries.findLast(isCanonicalEntry)
    if (snapshot === null || newest === undefined) return null
    return {
      conversationId,
      entries: journalEntries,
      stepsSinceLastSuccessfulReflection: state.steps_since_last_successful_reflection,
      reflectedThroughMessageId: state.reflected_through_message_id,
      newestMessageId: newest.source_message_id,
      lastActivity: newest.captured_at,
      totalBytes: conversationByteLength(snapshot.entries),
    }
  }))
  return conversations.filter((conversation): conversation is LoadedConversation => conversation !== null)
}

async function readReflectionState(
  statePath: string,
  entries: readonly TranscriptEntry[],
): Promise<ReflectionTranscriptState> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(statePath, "utf8"))
  } catch (error) {
    if (errorCode(error) !== "ENOENT" && !(error instanceof SyntaxError)) throw error
  }
  const value = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
  const reflectedThrough = typeof value.reflected_through_message_id === "string"
    && value.reflected_through_message_id.length > 0
    ? value.reflected_through_message_id
    : undefined
  const reflectedSteps = typeof value.reflected_completed_steps === "number"
    && Number.isInteger(value.reflected_completed_steps)
    && value.reflected_completed_steps >= 0
    ? value.reflected_completed_steps
    : 0
  return deriveState({
    ...initialReflectionState(),
    ...(reflectedThrough === undefined ? {} : { reflected_through_message_id: reflectedThrough }),
    reflected_completed_steps: reflectedSteps,
  }, entries)
}

function conversationByteLength(entries: readonly TranscriptEntry[]): number {
  const text = entries
    .map((entry) => {
      const fields: string[] = []
      if ("text" in entry) fields.push(entry.text)
      if (entry.kind === "tool_call" && entry.argsText !== undefined) fields.push(entry.argsText)
      if (entry.kind === "tool_call" && entry.resultText !== undefined) fields.push(entry.resultText)
      return fields.join("\n")
    })
    .filter((entry) => entry.length > 0)
    .join("\n")
  return Buffer.byteLength(text, "utf8")
}

function countSearchMatches(conversation: LoadedConversation, focus: string | undefined): number {
  if (focus === undefined || focus.trim().length === 0) return 0
  return searchTranscripts(
    { listConversations: () => [{ id: conversation.conversationId, messages: searchDocuments(conversation) }] },
    focus,
    { conversationId: conversation.conversationId, limit: 10 },
  ).length
}

function searchDocuments(conversation: LoadedConversation): SearchDocument[] {
  const grouped = new Map<string, TranscriptEntry[]>()
  for (const entry of conversation.entries) {
    const group = grouped.get(entry.source_message_id) ?? []
    group.push(entry)
    grouped.set(entry.source_message_id, group)
  }
  return [...grouped].map(([messageId, entries]) => {
    const textEntries = entries.filter((entry) => entry.kind !== "tool_call")
    const tools = entries.filter((entry) => entry.kind === "tool_call")
    const content = textEntries
      .filter((entry) => entry.kind !== "reasoning")
      .map((entry) => entry.text)
      .join("\n")
    const reasoning = textEntries
      .filter((entry) => entry.kind === "reasoning")
      .map((entry) => entry.text)
      .join("\n")
    return {
      id: messageId,
      conversationId: conversation.conversationId,
      date: entries.at(-1)?.captured_at,
      messageType: entries[0]?.kind,
      content,
      reasoning,
      toolCalls: tools.map((entry) => ({ name: entry.name, arguments: entry.argsText })),
      toolReturn: tools.map((entry) => entry.resultText).filter((text) => text !== undefined).join("\n"),
    }
  })
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
