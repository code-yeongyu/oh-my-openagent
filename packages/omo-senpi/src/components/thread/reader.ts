/**
 * Bounded transcript reader for thread_read.
 *
 * The durable truth of a Senpi session is the append-only JSONL tree the host
 * writes under its session directory; the in-memory turn log only exists while
 * some process holds the session. Two consequences shape this module:
 *
 *   1. The result names WHICH source answered (`source`), because a live host
 *      and the durable file are not interchangeable. On the jsonl path,
 *      `source_incomplete` is true exactly when no live host holds the session
 *      (the restart shape): the file is complete as far as it was flushed, but
 *      anything the dead process never persisted is unrecoverable.
 *   2. A session whose first assistant message has not landed yet has an empty
 *      or absent-of-entries file. That reads as an EMPTY transcript, never an
 *      error; only a genuinely missing file is `not_found`.
 *
 * Everything is bounded and synchronous: the file is read line by line in
 * fixed-size chunks the way the host's own loader reads it, entries are
 * encoded until the byte budget is spent, and the caller receives ONE payload
 * plus an opaque cursor. Nothing streams into the caller.
 *
 * Failures are data (authoring rules R6/R7): every error branch is
 * `{ kind: "error", error: { code, message, next_action } }` with a
 * `next_action` that names thread_list or the re-read to run, and nothing in
 * this module throws for an expected failure.
 */

import { closeSync, openSync, readSync } from "node:fs"
import { StringDecoder } from "node:string_decoder"

import { THREAD_READ_DEFAULT_BYTES, THREAD_READ_MAX_BYTES, type ThreadReadSource } from "./contracts"
import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "./errors"

/** Default number of trailing entries a tail read returns. */
export const THREAD_TAIL_DEFAULT_ITEMS = 60
/** Hard ceiling on a tail request; a larger `tail_items` is invalid_arguments. */
export const THREAD_TAIL_MAX_ITEMS = 200

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** A raw JSONL entry object, handed back unmodified. */
export type ThreadTranscriptEntry = { readonly [key: string]: JsonValue }

export type ThreadReadMode = "status" | "tail" | "page"

export type ThreadReadSourceRef =
  | {
      readonly kind: "live"
      /** Entries the resident host holds for this session, newest last. */
      readonly entries: () => readonly ThreadTranscriptEntry[]
    }
  | {
      readonly kind: "jsonl"
      /** Absolute path of the session's append-only JSONL file. */
      readonly path: string
      /**
       * Whether a live host currently holds this session. Absent or false is
       * the restart shape and yields `source_incomplete: true`.
       */
      readonly live_host_present?: boolean
    }

export type ThreadReadOptions = {
  readonly mode?: ThreadReadMode
  /** Trailing entry count for tail mode; default 60, max 200. */
  readonly tail_items?: number
  /** Encoded byte budget; default 128 KiB, hard cap 1 MiB. */
  readonly max_bytes?: number
  /** Opaque cursor from an earlier truncated read. */
  readonly cursor?: string
}

export type ThreadTranscriptReadOk = {
  readonly kind: "ok"
  /** Which source answered this read. */
  readonly source: ThreadReadSource
  /** True when the durable file answered while no live host held the session. */
  readonly source_incomplete: boolean
  readonly mode: ThreadReadMode
  readonly items: readonly ThreadTranscriptEntry[]
  /** Entries the source holds in total, independent of the returned slice. */
  readonly total_items: number
  readonly truncated: boolean
  readonly next_cursor: string | null
  /** UTF-8 bytes of the returned items as encoded against the budget. */
  readonly encoded_bytes: number
  /** The budget actually applied after defaulting and capping. */
  readonly max_bytes: number
  /** Unparseable or non-object JSONL lines skipped while loading. */
  readonly skipped_lines: number
}

export type ThreadTranscriptReadResult = ThreadTranscriptReadOk | { readonly kind: "error"; readonly error: ThreadToolFailure }

const READ_CHUNK_BYTES = 65536
const CURSOR_VERSION = "t1"

function fail(code: ThreadErrorCode, message: string, nextAction: string): ThreadTranscriptReadResult {
  return { kind: "error", error: threadToolFailure(code, message, nextAction) }
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type LoadedSource = {
  readonly entries: readonly ThreadTranscriptEntry[]
  readonly skippedLines: number
}

/**
 * Read the JSONL file and parse it line by line, in bounded chunks, the way
 * the host's own session loader does. The RETURNED payload is bounded by the
 * byte budget at selection time; the entry list itself is the file's content,
 * because the content revision a cursor binds to must span every entry for
 * staleness detection to be exact.
 *
 * A line that is not a JSON object - malformed syntax, a bare scalar, or a
 * run of non-UTF8 bytes decoded to replacement characters - is skipped and
 * counted rather than aborting the read, mirroring the host's loader.
 */
function loadJsonlFile(path: string): LoadedSource | "missing" {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, "r")
  } catch {
    return "missing"
  }
  try {
    const entries: ThreadTranscriptEntry[] = []
    let skippedLines = 0
    let pending = ""
    const decoder = new StringDecoder("utf8")
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES)
    const takeLine = (line: string): void => {
      const trimmed = line.trim()
      if (trimmed.length === 0) return
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        skippedLines += 1
        return
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        skippedLines += 1
        return
      }
      entries.push(parsed as ThreadTranscriptEntry)
    }

    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      pending += decoder.write(buffer.subarray(0, bytesRead))
      let lineStart = 0
      let newlineIndex = pending.indexOf("\n", lineStart)
      while (newlineIndex !== -1) {
        takeLine(pending.slice(lineStart, newlineIndex))
        lineStart = newlineIndex + 1
        newlineIndex = pending.indexOf("\n", lineStart)
      }
      pending = pending.slice(lineStart)
    }
    takeLine(pending + decoder.end())
    return { entries, skippedLines }
  } catch {
    // An unreadable file that opened is treated as an empty transcript rather
    // than a crash; the caller still learns the source answered.
    return { entries: [], skippedLines: 0 }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

// ---------------------------------------------------------------------------
// Revision + cursor
// ---------------------------------------------------------------------------

/**
 * Content revision a cursor is bound to: the entry count plus a cheap hash of
 * the last entry's identity. An append changes the count, a rewrite changes
 * the tail identity, and a truncation changes both - each invalidates the
 * cursor instead of silently re-slicing a different transcript.
 */
function revisionOf(entries: readonly ThreadTranscriptEntry[]): string {
  const last = entries[entries.length - 1]
  const tail = last === undefined ? "" : `${String(last.id ?? "")}|${String(last.timestamp ?? "")}|${JSON.stringify(last).length}`
  let hash = 2166136261
  for (let index = 0; index < tail.length; index += 1) {
    hash ^= tail.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${entries.length}.${(hash >>> 0).toString(36)}`
}

type Cursor = { readonly revision: string; readonly offset: number }

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${CURSOR_VERSION}:${cursor.revision}:${cursor.offset}`, "utf8").toString("base64url")
}

function decodeCursor(raw: string): Cursor | null {
  if (typeof raw !== "string" || raw.length === 0) return null
  let decoded: string
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8")
  } catch {
    return null
  }
  const parts = decoded.split(":")
  if (parts.length !== 3) return null
  const [version, revision, rawOffset] = parts
  if (version !== CURSOR_VERSION) return null
  if (!/^\d+\.[0-9a-z]+$/.test(revision)) return null
  const offset = Number(rawOffset)
  if (!Number.isSafeInteger(offset) || offset < 0) return null
  return { revision, offset }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Read one bounded slice of a session transcript.
 *
 * `status` returns metadata only, `tail` returns the last N entries, and
 * `page` walks forward from an opaque cursor. Truncation is a budget outcome,
 * not a failure: the payload comes back with `truncated: true` and a
 * `next_cursor` that resumes exactly after the last returned entry.
 */
export function readTranscript(source: ThreadReadSourceRef, opts: ThreadReadOptions = {}): ThreadTranscriptReadResult {
  const mode: ThreadReadMode = opts.mode ?? "tail"
  if (mode !== "status" && mode !== "tail" && mode !== "page") {
    return fail(
      "invalid_arguments",
      `Unknown read mode "${String(mode)}".`,
      'Retry with mode set to "status", "tail", or "page", or call thread_list to confirm the thread first.',
    )
  }

  if (opts.tail_items !== undefined) {
    if (!isPositiveInteger(opts.tail_items)) {
      return fail(
        "invalid_arguments",
        `tail_items must be a positive whole number; received ${String(opts.tail_items)}.`,
        `Retry with tail_items between 1 and ${THREAD_TAIL_MAX_ITEMS}, or omit it to take the default ${THREAD_TAIL_DEFAULT_ITEMS}.`,
      )
    }
    if (opts.tail_items > THREAD_TAIL_MAX_ITEMS) {
      return fail(
        "invalid_arguments",
        `tail_items ${opts.tail_items} exceeds the ${THREAD_TAIL_MAX_ITEMS}-item cap.`,
        `Retry with tail_items at most ${THREAD_TAIL_MAX_ITEMS}, then page backward with the returned cursor if you need more.`,
      )
    }
  }

  if (opts.max_bytes !== undefined) {
    if (!isPositiveInteger(opts.max_bytes)) {
      return fail(
        "invalid_arguments",
        `max_bytes must be a positive whole number; received ${String(opts.max_bytes)}.`,
        `Retry with max_bytes between 1 and ${THREAD_READ_MAX_BYTES}, or omit it to take the default ${THREAD_READ_DEFAULT_BYTES}.`,
      )
    }
    if (opts.max_bytes > THREAD_READ_MAX_BYTES) {
      return fail(
        "message_too_large",
        `max_bytes ${opts.max_bytes} exceeds the ${THREAD_READ_MAX_BYTES}-byte hard cap.`,
        `Re-read with max_bytes at most ${THREAD_READ_MAX_BYTES} and follow next_cursor for the rest of the transcript.`,
      )
    }
  }

  const maxBytes = opts.max_bytes ?? THREAD_READ_DEFAULT_BYTES
  const tailItems = opts.tail_items ?? THREAD_TAIL_DEFAULT_ITEMS

  let cursor: Cursor | null = null
  if (opts.cursor !== undefined) {
    cursor = decodeCursor(opts.cursor)
    if (cursor === null) {
      return fail(
        "cursor_invalid",
        "The cursor is not a cursor this reader issued.",
        "Re-read the thread without a cursor to get a fresh next_cursor, or call thread_list to confirm the thread address.",
      )
    }
  }

  let loaded: LoadedSource
  let readSourceKind: ThreadReadSource
  let sourceIncomplete: boolean

  if (source.kind === "live") {
    readSourceKind = "live_host"
    sourceIncomplete = false
    loaded = { entries: source.entries(), skippedLines: 0 }
  } else {
    readSourceKind = "session_jsonl"
    sourceIncomplete = source.live_host_present !== true
    const file = loadJsonlFile(source.path)
    if (file === "missing") {
      return fail(
        "not_found",
        `No session transcript exists at ${source.path}.`,
        "Call thread_list to get a current thread_id, then read that thread instead.",
      )
    }
    loaded = file
  }

  const entries = loaded.entries
  const revision = revisionOf(entries)

  if (cursor !== null && cursor.revision !== revision) {
    return fail(
      "cursor_stale",
      "The transcript changed after this cursor was issued, so its position no longer names the same entries.",
      "Re-read the thread without a cursor to restart from a current revision.",
    )
  }

  const base: Omit<ThreadTranscriptReadOk, "items" | "truncated" | "next_cursor" | "encoded_bytes"> = {
    kind: "ok",
    source: readSourceKind,
    source_incomplete: sourceIncomplete,
    mode,
    total_items: entries.length,
    max_bytes: maxBytes,
    skipped_lines: loaded.skippedLines,
  }

  if (mode === "status") {
    return { ...base, items: [], truncated: false, next_cursor: null, encoded_bytes: 0 }
  }

  // tail selects the trailing window and then applies the same byte budget
  // forward through it, so a huge trailing entry still truncates cleanly.
  const start = mode === "tail" ? Math.max(0, entries.length - tailItems) : (cursor?.offset ?? 0)
  const window = entries.slice(start)

  const selected: ThreadTranscriptEntry[] = []
  let encodedBytes = 0
  let consumed = 0
  for (const entry of window) {
    const size = Buffer.byteLength(JSON.stringify(entry), "utf8")
    // The first entry always ships even when it alone overruns the budget, so
    // a page can never stall on an oversized entry.
    if (selected.length > 0 && encodedBytes + size > maxBytes) break
    selected.push(entry)
    encodedBytes += size
    consumed += 1
  }

  const nextOffset = start + consumed
  const truncated = nextOffset < entries.length
  return {
    ...base,
    items: selected,
    truncated,
    next_cursor: truncated ? encodeCursor({ revision, offset: nextOffset }) : null,
    encoded_bytes: encodedBytes,
  }
}
