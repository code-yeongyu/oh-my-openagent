import { closeSync, fstatSync, openSync, readSync } from "node:fs"

/** How many bytes each end of a session file is read for its facts: listing never reads a whole transcript. */
export const SESSION_FACTS_WINDOW_BYTES = 64 * 1024

/** A thread with no name is shown by the start of its first user message, cut to this many characters. */
export const THREAD_TITLE_MAX_CHARS = 60

export type SessionFacts = {
  readonly durable_id: string
  readonly cwd: string
  readonly created_at: string
  readonly updated_at: string
  /** The last `session_info` name (`/name`, `set_session_name`), or `null` when none was set or it was cleared. */
  readonly name: string | null
  readonly first_user_text: string | null
}

type JsonRecord = Record<string, unknown>

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

function parseLines(text: string, dropFirst: boolean, dropLast: boolean): JsonRecord[] {
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

type NameState = { readonly seen: boolean; readonly name: string | null }

function lastName(entries: readonly JsonRecord[], initial: NameState): NameState {
  let state = initial
  for (const entry of entries) {
    if (entry.type !== "session_info") continue
    state = { seen: true, name: typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name.trim() : null }
  }
  return state
}

function firstUser(entries: readonly JsonRecord[]): string | null {
  for (const entry of entries) {
    if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") continue
    const text = messageText(entry.message.content).trim()
    if (text.length > 0) return text
  }
  return null
}

function newestTimestamp(entries: readonly JsonRecord[], floor: string): string {
  let newest = floor
  for (const entry of entries) if (typeof entry.timestamp === "string" && entry.timestamp > newest) newest = entry.timestamp
  return newest
}

/**
 * Name, timestamps and first user message of one session JSONL, read from its first and last
 * SESSION_FACTS_WINDOW_BYTES only, so a listing costs two bounded reads per session whatever the
 * transcript's size. A rename recorded only in the unread middle of a very long file is missed here;
 * a live endpoint reports the current name itself, and the full disk scan is used when none answers.
 * `null` when the file is unreadable or has no session header.
 */
export function readSessionFacts(path: string): SessionFacts | null {
  let fd: number
  try {
    fd = openSync(path, "r")
  } catch {
    return null
  }
  try {
    const size = fstatSync(fd).size
    const headLength = Math.min(size, SESSION_FACTS_WINDOW_BYTES)
    const head = Buffer.alloc(headLength)
    readSync(fd, head, 0, headLength, 0)
    const whole = size <= SESSION_FACTS_WINDOW_BYTES
    const headEntries = parseLines(head.toString("utf8"), false, !whole)
    const header = headEntries[0]
    if (header === undefined || header.type !== "session" || typeof header.id !== "string" || typeof header.cwd !== "string" || typeof header.timestamp !== "string") return null
    let tailEntries: JsonRecord[] = []
    if (!whole) {
      const tailStart = Math.max(headLength, size - SESSION_FACTS_WINDOW_BYTES)
      const tail = Buffer.alloc(size - tailStart)
      readSync(fd, tail, 0, tail.length, tailStart)
      tailEntries = parseLines(tail.toString("utf8"), true, false)
    }
    const named = lastName(tailEntries, lastName(headEntries, { seen: false, name: null }))
    const updated = newestTimestamp(tailEntries, newestTimestamp(headEntries, header.timestamp))
    return {
      durable_id: header.id,
      cwd: header.cwd,
      created_at: header.timestamp,
      updated_at: updated,
      name: named.name,
      first_user_text: firstUser(headEntries) ?? firstUser(tailEntries),
    }
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}
