import { join } from "path"
import { mkdirSync, appendFileSync, existsSync, writeFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { randomUUID } from "crypto"
import type { TranscriptEntry } from "./types"
import { transformToolName } from "../../shared/tool-name"
import { getClaudeConfigDir, log } from "../../shared"

const TRANSCRIPT_DIR = join(getClaudeConfigDir(), "transcripts")

export function getTranscriptPath(sessionId: string): string {
  return join(TRANSCRIPT_DIR, `${sessionId}.jsonl`)
}

function ensureTranscriptDir(): void {
  if (!existsSync(TRANSCRIPT_DIR)) {
    mkdirSync(TRANSCRIPT_DIR, { recursive: true })
  }
}

export function appendTranscriptEntry(
  sessionId: string,
  entry: TranscriptEntry
): void {
  ensureTranscriptDir()
  const path = getTranscriptPath(sessionId)
  const line = JSON.stringify(entry) + "\n"
  appendFileSync(path, line)
}

interface OpenCodeMessagePart {
  type: string
  tool?: string
  /** OpenCode 2 stores the tool name here; the v2 session facade also aliases it to `tool`. */
  name?: string
  state?: {
    status?: string
    input?: Record<string, unknown>
  }
}

interface OpenCodeMessage {
  info?: {
    role?: string
  }
  parts?: OpenCodeMessagePart[]
}

interface DisabledTranscriptEntry {
  type: "assistant"
  message: {
    role: "assistant"
    content: Array<{
      type: "tool_use"
      name: string
      input: Record<string, unknown>
    }>
  }
}

interface TranscriptCacheEntry {
  baseEntries: string[]
  tempPath: string | null
  createdAt: number
  expiresAt: number
}

export const TRANSCRIPT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
/**
 * How long a failed history fetch is remembered. Every PostToolUse hook builds a transcript, so
 * without this a session whose history cannot be read re-fetches and re-fails on every tool call
 * (6,924 identical log lines in three days on OpenCode 2 before the v2 tool-part alias landed).
 */
export const TRANSCRIPT_FAILURE_RETRY_MS = 60 * 1000 // 1 minute
const TRANSCRIPT_CACHE_PRUNE_INTERVAL_MS = TRANSCRIPT_CACHE_TTL_MS

const transcriptCache = new Map<string, TranscriptCacheEntry>()
let cleanupInterval: ReturnType<typeof setInterval> | null = null

/**
 * JSON.stringify(new Error("x")) is "{}": message, name and stack are not enumerable. Spell the
 * useful fields out so the log line says what failed.
 */
export function describeTranscriptError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { thrown: String(error) }
  const described: Record<string, unknown> = { name: error.name, message: error.message }
  for (const key of ["code", "errno", "syscall", "path"] as const) {
    const value = (error as unknown as Record<string, unknown>)[key]
    if (value !== undefined) described[key] = value
  }
  if (error.stack) described.stack = error.stack.split("\n").slice(0, 4).join("\n")
  if (error.cause !== undefined) described.cause = error.cause instanceof Error ? error.cause.message : String(error.cause)
  return described
}

function logTranscriptError(message: string, error: unknown): void {
  log(message, { error: describeTranscriptError(error) })
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === "ENOENT"
}

/**
 * Clear transcript cache for a specific session or all sessions.
 * Call on session.deleted to prevent memory accumulation.
 */
export function clearTranscriptCache(sessionId?: string): void {
  if (sessionId) {
    const entry = transcriptCache.get(sessionId)
    if (entry?.tempPath) {
      try {
        unlinkSync(entry.tempPath)
      } catch (error) {
        if (!isMissingFile(error)) logTranscriptError("[transcript] failed to clean up cached temp transcript", error)
      }
    }
    transcriptCache.delete(sessionId)
  } else {
    for (const [, entry] of transcriptCache) {
      if (entry.tempPath) {
        try {
          unlinkSync(entry.tempPath)
        } catch (error) {
          if (!isMissingFile(error)) logTranscriptError("[transcript] failed to clean up cached temp transcript", error)
        }
      }
    }
    transcriptCache.clear()
  }
}

export function hasTranscriptCacheEntry(sessionId: string): boolean {
  return transcriptCache.has(sessionId)
}

function pruneExpiredTranscriptCache(): void {
  const now = Date.now()
  for (const sessionId of [...transcriptCache.keys()]) {
    const entry = transcriptCache.get(sessionId)
    if (!entry || now >= entry.expiresAt) {
      clearTranscriptCache(sessionId)
    }
  }
}

function ensureTranscriptCacheCleanup(): void {
  if (cleanupInterval) return
  cleanupInterval = setInterval(pruneExpiredTranscriptCache, TRANSCRIPT_CACHE_PRUNE_INTERVAL_MS)
  if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
    cleanupInterval.unref()
  }
}

export function stopTranscriptCacheCleanup(): void {
  clearTranscriptCache()
  if (!cleanupInterval) return
  clearInterval(cleanupInterval)
  cleanupInterval = null
}

function isCacheValid(entry: TranscriptCacheEntry): boolean {
  return Date.now() < entry.expiresAt
}

function buildCurrentEntry(toolName: string, toolInput: Record<string, unknown>): string {
  const entry: DisabledTranscriptEntry = {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          name: transformToolName(toolName),
          input: toolInput,
        },
      ],
    },
  }
  return JSON.stringify(entry)
}

function parseMessagesToEntries(messages: OpenCodeMessage[]): string[] {
  const entries: string[] = []
  for (const msg of messages) {
    if (msg.info?.role !== "assistant") continue
    for (const part of msg.parts || []) {
      if (part.type !== "tool") continue
      if (part.state?.status !== "completed") continue
      if (!part.state?.input) continue

      // OpenCode 1 parts carry `tool`; OpenCode 2 stored parts carry `name`. A part with neither is
      // not a transcript entry; it must not abort the whole transcript.
      const rawToolName = typeof part.tool === "string" ? part.tool : typeof part.name === "string" ? part.name : undefined
      if (!rawToolName) continue
      const toolName = transformToolName(rawToolName)

      const entry: DisabledTranscriptEntry = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: toolName, input: part.state.input }],
        },
      }
      entries.push(JSON.stringify(entry))
    }
  }
  return entries
}

function writeTempTranscript(sessionId: string, entries: readonly string[]): string {
  const tempPath = join(
    tmpdir(),
    `opencode-transcript-${sessionId}-${randomUUID()}.jsonl`
  )
  writeFileSync(tempPath, entries.join("\n") + "\n")
  return tempPath
}

/**
 * Build Claude Code compatible transcript from session messages.
 * Uses per-session cache to avoid redundant session.messages() API calls.
 * First call fetches and caches; subsequent calls reuse cached base entries.
 */
export async function buildTranscriptFromSession(
  client: {
    session: {
      messages: (opts: { path: { id: string }; query?: { directory: string } }) => Promise<unknown>
    }
  },
  sessionId: string,
  directory: string,
  currentToolName: string,
  currentToolInput: Record<string, unknown>
): Promise<string | null> {
  try {
    let baseEntries: string[]
    let previousTempPath: string | null = null

    const cached = transcriptCache.get(sessionId)
    if (cached && isCacheValid(cached)) {
      baseEntries = cached.baseEntries
      previousTempPath = cached.tempPath
    } else {
      let fetched: string[]
      try {
        const response = await client.session.messages({
          path: { id: sessionId },
          query: { directory },
        })

        const messages = (response as { "200"?: unknown[]; data?: unknown[] })["200"]
          ?? (response as { data?: unknown[] }).data
          ?? (Array.isArray(response) ? response : [])

        fetched = Array.isArray(messages)
          ? parseMessagesToEntries(messages as OpenCodeMessage[])
          : []
      } catch (error) {
        logTranscriptError("[transcript] failed to build transcript from session", error)
        // Remember the failure for a bounded window: the next tool calls get the current-tool
        // transcript without re-reading (and re-failing on) the whole session history.
        fetched = []
        previousTempPath = cached?.tempPath ?? null
        transcriptCache.set(sessionId, {
          baseEntries: fetched,
          tempPath: null,
          createdAt: Date.now(),
          expiresAt: Date.now() + TRANSCRIPT_FAILURE_RETRY_MS,
        })
        ensureTranscriptCacheCleanup()
        baseEntries = fetched
        if (previousTempPath) deleteTempTranscript(previousTempPath)
        const tempPath = writeTempTranscript(sessionId, [buildCurrentEntry(currentToolName, currentToolInput)])
        const entry = transcriptCache.get(sessionId)
        if (entry) entry.tempPath = tempPath
        return tempPath
      }
      baseEntries = fetched

      if (cached?.tempPath) {
        try {
          unlinkSync(cached.tempPath)
        } catch (error) {
          if (!isMissingFile(error)) logTranscriptError("[transcript] failed to clean up stale temp transcript", error)
        }
      }

      transcriptCache.set(sessionId, {
        baseEntries,
        tempPath: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + TRANSCRIPT_CACHE_TTL_MS,
      })
      ensureTranscriptCacheCleanup()
    }

    const allEntries = [...baseEntries, buildCurrentEntry(currentToolName, currentToolInput)]

    if (previousTempPath) {
      try {
        unlinkSync(previousTempPath)
      } catch (error) {
        // The hook runner deletes the file it was handed (deleteTempTranscript), so a missing
        // previous transcript is the normal case, not an error.
        if (!isMissingFile(error)) logTranscriptError("[transcript] failed to clean up previous temp transcript", error)
      }
    }

    const tempPath = writeTempTranscript(sessionId, allEntries)

    const cacheEntry = transcriptCache.get(sessionId)
    if (cacheEntry) {
      // baseEntries MUST stay pinned to the last session.messages() fetch.
      // Previously we wrote `allEntries` (= baseEntries + synthetic current
      // tool entry) back here and also reset createdAt on every call, so the
      // cached baseline grew by one entry per PostToolUse and the TTL never
      // expired — long sessions accumulated arbitrarily large transcript
      // state and re-opening the session jumped to multi-GB JS retention
      // (#3647). Refreshing baseEntries happens on TTL expiry via the
      // normal cache-miss path; do NOT mutate it here.
      cacheEntry.tempPath = tempPath
    }

    return tempPath
  } catch (error) {
    logTranscriptError("[transcript] failed to build transcript from session", error)
    try {
      return writeTempTranscript(sessionId, [buildCurrentEntry(currentToolName, currentToolInput)])
    } catch (fallbackError) {
      logTranscriptError("[transcript] failed to write fallback transcript", fallbackError)
      return null
    }
  }
}

export function deleteTempTranscript(path: string | null): void {
  if (!path) return
  // The cache must not point at a file that no longer exists, or the next build tries to unlink
  // it again.
  for (const entry of transcriptCache.values()) {
    if (entry.tempPath === path) entry.tempPath = null
  }
  try {
    unlinkSync(path)
  } catch (error) {
    if (!isMissingFile(error)) logTranscriptError("[transcript] failed to delete temp transcript", error)
  }
}
