import { closeSync, fstatSync, openSync, readSync } from "node:fs"

/** How many bytes each end of a session file is read for its facts: listing never reads a whole transcript. */
export const SESSION_FACTS_WINDOW_BYTES = 64 * 1024

/** Largest final JSONL entry read to prove the newest timestamp; larger entries make activity unknown. */
export const SESSION_FACTS_LAST_LINE_MAX_BYTES = SESSION_FACTS_WINDOW_BYTES * 4

/** A thread with no name is shown by the start of its first user message, cut to this many characters. */
export const THREAD_TITLE_MAX_CHARS = 60

export type SessionFacts = {
  readonly durable_id: string
  readonly cwd: string
  readonly created_at: string
  readonly updated_at: string | null
  /** The last `session_info` name (`/name`, `set_session_name`), or `null` when none was set or it was cleared. */
  readonly name: string | null
  readonly first_user_text: string | null
}

export type JsonRecord = Record<string, unknown>

type SessionRead = (fd: number, buffer: Buffer, offset: number, length: number, position: number) => number

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function messageText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.flatMap((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join(" ")
}

/** The display title of a thread: its name, else the first user message's opening; never its id. */
export function threadTitle(name: string | null | undefined, firstUserText: string | null | undefined): string | null {
  const explicit = name?.trim()
  if (explicit !== undefined && explicit.length > 0) return explicit
  const text = firstUserText?.replace(/\s+/g, " ").trim()
  if (text === undefined || text.length === 0) return null
  return [...text].slice(0, THREAD_TITLE_MAX_CHARS).join("")
}

/** Each line of a session JSONL that parses as an object; `dropFirst`/`dropLast` discard lines a window may have cut. */
export function parseSessionLines(text: string, dropFirst = false, dropLast = false): JsonRecord[] {
  const lines = text.split("\n")
  if (dropFirst) lines.shift()
  if (dropLast) lines.pop()
  return lines.flatMap((line) => {
    if (line.trim().length === 0) return []
    try {
      const parsed: unknown = JSON.parse(line)
      return isRecord(parsed) ? [parsed] : []
    } catch {
      return []
    }
  })
}

export type SessionEntrySummary = {
  /** The first `session` entry naming an id. */
  readonly header: JsonRecord | null
  /** The last `session_info` name; a later `session_info` without one clears it. */
  readonly name: string | null
  readonly first_user_text: string | null
  /** The newest entry timestamp, `""` when no entry carries one. */
  readonly newest_timestamp: string
}

/** One pass over session entries in file order: the rules every reader of a session file shares. */
export function summarizeSessionEntries(entries: readonly JsonRecord[]): SessionEntrySummary {
  let header: JsonRecord | null = null
  let name: string | null = null
  let firstUserText: string | null = null
  let newest = ""
  for (const entry of entries) {
    if (header === null && entry.type === "session" && typeof entry.id === "string") header = entry
    if (entry.type === "session_info") name = typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name.trim() : null
    if (firstUserText === null && entry.type === "message" && isRecord(entry.message) && entry.message.role === "user") {
      const text = messageText(entry.message.content).trim()
      if (text.length > 0) firstUserText = text
    }
    if (typeof entry.timestamp === "string" && entry.timestamp > newest) newest = entry.timestamp
  }
  return { header, name, first_user_text: firstUserText, newest_timestamp: newest }
}

function finalEntryTimestamp(line: Buffer | null): string | null {
  if (line === null) return null
  try {
    const entry: unknown = JSON.parse(line.toString("utf8"))
    return isRecord(entry) && typeof entry.timestamp === "string" && entry.timestamp.length > 0 ? entry.timestamp : null
  } catch {
    return null
  }
}

function finalCompleteLine(fd: number, size: number, read: SessionRead): Buffer | null {
  if (size === 0) return null
  const finalByte = Buffer.allocUnsafe(1)
  if (read(fd, finalByte, 0, 1, size - 1) !== 1 || finalByte[0] !== 0x0a) return null
  let remaining = size - 1
  let scanned = 0
  const chunks: Buffer[] = []
  while (remaining > 0 && scanned < SESSION_FACTS_LAST_LINE_MAX_BYTES) {
    const length = Math.min(SESSION_FACTS_WINDOW_BYTES, remaining, SESSION_FACTS_LAST_LINE_MAX_BYTES - scanned)
    const start = remaining - length
    const chunk = Buffer.allocUnsafe(length)
    if (read(fd, chunk, 0, length, start) !== length) return null
    const newline = chunk.lastIndexOf(0x0a)
    chunks.unshift(newline === -1 ? chunk : chunk.subarray(newline + 1))
    if (newline !== -1 || start === 0) return Buffer.concat(chunks)
    scanned += length
    remaining = start
  }
  return null
}

/**
 * Name, timestamps and first user message of one session JSONL, read from its first and last
 * SESSION_FACTS_WINDOW_BYTES plus a bounded scan for the final complete line. A rename recorded only
 * in the unread middle of a very long file is missed here; a live endpoint reports the current name
 * itself. `updated_at` is null when the final line is partial, malformed, or larger than
 * SESSION_FACTS_LAST_LINE_MAX_BYTES, because an older timestamp must never be reported as newest.
 * `null` when the file is unreadable or has no session header.
 */
export function readSessionFacts(path: string, read: SessionRead = readSync): SessionFacts | null {
  let fd: number
  try {
    fd = openSync(path, "r")
  } catch {
    return null
  }
  try {
    const before = fstatSync(fd)
    const size = before.size
    const headLength = Math.min(size, SESSION_FACTS_WINDOW_BYTES)
    const head = Buffer.alloc(headLength)
    read(fd, head, 0, headLength, 0)
    const whole = size <= SESSION_FACTS_WINDOW_BYTES
    const headEntries = parseSessionLines(head.toString("utf8"), false, !whole)
    const first = headEntries[0]
    if (first === undefined || first.type !== "session" || typeof first.id !== "string" || typeof first.cwd !== "string" || typeof first.timestamp !== "string") return null
    let tailEntries: JsonRecord[] = []
    if (!whole) {
      const tailStart = Math.max(headLength, size - SESSION_FACTS_WINDOW_BYTES)
      const tail = Buffer.alloc(size - tailStart)
      read(fd, tail, 0, tail.length, tailStart)
      tailEntries = parseSessionLines(tail.toString("utf8"), true, false)
    }
    const summary = summarizeSessionEntries([...headEntries, ...tailEntries])
    const finalLine = finalCompleteLine(fd, size, read)
    const after = fstatSync(fd)
    const updatedAt = after.size === before.size && after.mtimeMs === before.mtimeMs
      ? finalEntryTimestamp(finalLine)
      : null
    return {
      durable_id: first.id,
      cwd: first.cwd,
      created_at: first.timestamp,
      updated_at: updatedAt,
      name: summary.name,
      first_user_text: summary.first_user_text,
    }
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}
