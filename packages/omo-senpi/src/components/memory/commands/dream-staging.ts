import { createHash } from "node:crypto"
import { readFile, stat } from "@oh-my-opencode/memory-core/fs"
import { resolve } from "node:path"

import {
  TranscriptJournal,
  projectTranscriptEntries,
} from "@oh-my-opencode/memory-core"

import { projectSessionEntries } from "../journal-wiring"

const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024

export interface StagedDreamTranscript {
  readonly conversationId: string
  readonly stagedMessageIds: readonly string[]
  readonly skippedMessageIds: readonly string[]
}

interface NormalizedSessionEntry {
  readonly value: Record<string, unknown>
  readonly capturedAt: string
}

export async function stageDreamTranscript(
  inputPath: string,
  transcriptsDir: string,
  cwd: string,
): Promise<StagedDreamTranscript> {
  const filePath = resolve(cwd, inputPath)
  const metadata = await stat(filePath)
  if (!metadata.isFile()) throw new TypeError("--from transcript:<path> must name a senpi session JSONL file")
  if (metadata.size > MAX_TRANSCRIPT_BYTES) throw new TypeError("--from transcript file exceeds the 64 MiB limit")

  const bytes = await readFile(filePath)
  let raw: string
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new TypeError("--from transcript file must be valid UTF-8")
  }

  const fallbackCapturedAt = metadata.mtime.toISOString()
  const normalized: NormalizedSessionEntry[] = []
  let hasSessionHeader = false
  for (const [lineIndex, line] of raw.split("\n").entries()) {
    if (line.trim().length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(parsed)) continue
    if (parsed.type === "session" && typeof parsed.id === "string") {
      hasSessionHeader = true
      continue
    }
    const item = normalizeMessage(parsed, filePath, lineIndex, fallbackCapturedAt)
    if (item !== undefined) normalized.push(item)
  }
  if (!hasSessionHeader || normalized.length === 0) {
    throw new TypeError("--from accepts only senpi session JSONL with a session header and message rows")
  }

  const capturedAtById = new Map(normalized.map((item) => [String(item.value.id), item.capturedAt]))
  const projections = projectSessionEntries(normalized.map((item) => item.value))
  const entries = projections.flatMap((projection) =>
    projectTranscriptEntries(projection, capturedAtById.get(projection.messageId) ?? fallbackCapturedAt),
  )
  if (entries.length === 0) {
    throw new TypeError("--from senpi session JSONL contains no stageable user or assistant messages")
  }

  const conversationId = `from-transcript-${sha1(filePath).slice(0, 12)}`
  const journal = new TranscriptJournal({ journalDir: `${transcriptsDir}/${conversationId}` })
  const existingMessageIds = new Set((await journal.readEntries()).map((entry) => entry.source_message_id))
  const fresh = entries.filter((entry) => !existingMessageIds.has(entry.source_message_id))
  const stagedMessageIds = unique(fresh.map((entry) => entry.source_message_id))
  const skippedMessageIds = unique(entries
    .filter((entry) => existingMessageIds.has(entry.source_message_id))
    .map((entry) => entry.source_message_id))
  await journal.append(fresh)
  return { conversationId, stagedMessageIds, skippedMessageIds }
}

function normalizeMessage(
  row: Record<string, unknown>,
  filePath: string,
  lineIndex: number,
  fallbackCapturedAt: string,
): NormalizedSessionEntry | undefined {
  if (row.type !== "message" || !isRecord(row.message) || typeof row.message.role !== "string") return undefined
  const suppliedId = stringOf(row.source_message_id)
  const text = messageText(row.message)
  const id = suppliedId ?? sha1(`${filePath}:${lineIndex}:${text}`).slice(0, 16)
  const capturedAt = stringOf(row.captured_at) ?? fallbackCapturedAt
  return { value: { ...row, id }, capturedAt }
}

function messageText(message: Record<string, unknown>): string {
  if (typeof message.content === "string") return message.content
  if (!Array.isArray(message.content)) return ""
  const values: string[] = []
  for (const part of message.content) {
    if (!isRecord(part)) continue
    for (const key of ["text", "thinking"] as const) {
      const value = stringOf(part[key])
      if (value !== undefined) values.push(value)
    }
    if (part.type === "toolCall" && part.arguments !== undefined) values.push(safeStringify(part.arguments))
  }
  return values.join("\n")
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex")
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
