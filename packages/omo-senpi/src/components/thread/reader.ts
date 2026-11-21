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
 * Everything is bounded and synchronous: a tail read (and the pages of its
 * window) reads the file backward from its end in fixed-size chunks and stops
 * once it holds the window, so its cost follows the window and never the file
 * (a seat transcript reaches hundreds of MB, #14418); status and forward page
 * reads take the whole file line by line, the way the host's own loader reads
 * it. Entries are encoded until the byte budget is spent, and the caller
 * receives ONE payload plus an opaque cursor. Nothing streams into the caller.
 *
 * Failures are data (authoring rules R6/R7): every error branch is
 * `{ kind: "error", error: { code, message, next_action } }` with a
 * `next_action` that names thread_list or the re-read to run, and nothing in
 * this module throws for an expected failure.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs"
import { StringDecoder } from "node:string_decoder"

import { THREAD_READ_DEFAULT_BYTES, THREAD_READ_MAX_BYTES, type ThreadReadSource } from "./contracts"
import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "./errors"
import { takeWithinBudget } from "./read-budget"

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
  /**
   * Entries the source holds in total, independent of the returned slice; null when a tail read of the session file
   * stopped before the file's start, so the older entries were never counted.
   */
  readonly total_items: number | null
  readonly truncated: boolean
  readonly next_cursor: string | null
  /** UTF-8 bytes of the returned items as encoded against the budget. */
  readonly encoded_bytes: number
  /** The budget actually applied after defaulting and capping. */
  readonly max_bytes: number
  /** Unparseable or non-object JSONL lines skipped while loading. */
  readonly skipped_lines: number
}

export type ThreadTranscriptReadResult =
  ThreadTranscriptReadOk | { readonly kind: "error"; readonly error: ThreadToolFailure }

const READ_CHUNK_BYTES = 65536
const CURSOR_VERSION = "t1"
const OLDER_CURSOR_VERSION = "t1o"
const FILE_TAIL_CURSOR_VERSION = "t1t"
const NEWLINE = 0x0a

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
 * One JSONL line as an entry. A line that is not a JSON object - malformed syntax, a bare scalar, or a run of non-UTF8
 * bytes decoded to replacement characters - is `skipped`; a blank line is `blank` and not counted.
 */
function parseLine(line: string): ThreadTranscriptEntry | "skipped" | "blank" {
  const trimmed = line.trim()
  if (trimmed.length === 0) return "blank"
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return "skipped"
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "skipped"
  return parsed as ThreadTranscriptEntry
}

/**
 * Read the JSONL file and parse it line by line, in bounded chunks, the way
 * the host's own session loader does. The RETURNED payload is bounded by the
 * byte budget at selection time; the entry list itself is the file's content,
 * because the content revision a cursor binds to must span every entry for
 * staleness detection to be exact.
 *
 * A line that is not a JSON object is skipped and counted rather than aborting
 * the read, mirroring the host's loader.
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
      const entry = parseLine(line)
      if (entry === "skipped") skippedLines += 1
      else if (entry !== "blank") entries.push(entry)
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

type LoadedTail = LoadedSource & {
  /** The file's size when it was read: every append, truncation or rewrite of another length changes it. */
  readonly size: number
  /** Whether the read reached the file's first line, so `entries` is the whole transcript. */
  readonly whole: boolean
}

/**
 * The file's last `count` entries, read backward from its end in fixed-size chunks (#14418): the bytes read and the
 * entries parsed follow the window, never the file, so an 840 MB transcript answers like a small one. Lines are split
 * on the newline byte, which never occurs inside a UTF-8 sequence, and each is decoded on its own; a line longer than a
 * chunk is assembled once from its chunks. Only the bytes present when the read starts are read, so an append racing
 * the read is the next read's.
 */
function loadJsonlTail(path: string, count: number): LoadedTail | "missing" {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, "r")
  } catch {
    return "missing"
  }
  let size = 0
  try {
    size = fstatSync(descriptor).size
    const newestFirst: ThreadTranscriptEntry[] = []
    let skippedLines = 0
    const take = (line: Buffer): void => {
      const entry = parseLine(line.toString("utf8"))
      if (entry === "skipped") skippedLines += 1
      else if (entry !== "blank") newestFirst.push(entry)
    }
    // The bytes after the newest newline found so far that belong to a line whose start is not read yet, oldest first.
    let pending: Buffer[] = []
    let position = size
    while (newestFirst.length < count && position > 0) {
      const length = Math.min(READ_CHUNK_BYTES, position)
      position -= length
      const chunk = Buffer.allocUnsafe(length)
      let read = 0
      while (read < length) {
        const got = readSync(descriptor, chunk, read, length - read, position + read)
        // The file shrank under the read: what was read no longer names a transcript.
        if (got === 0) throw new Error("session file truncated during the read")
        read += got
      }
      let end = read
      while (end > 0 && newestFirst.length < count) {
        const newline = chunk.lastIndexOf(NEWLINE, end - 1)
        if (newline === -1) break
        take(Buffer.concat([chunk.subarray(newline + 1, end), ...pending]))
        pending = []
        end = newline
      }
      pending = [chunk.subarray(0, end), ...pending]
    }
    const whole = position === 0 && newestFirst.length < count
    if (whole) take(Buffer.concat(pending))
    return { entries: newestFirst.reverse(), skippedLines, size, whole }
  } catch {
    return { entries: [], skippedLines: 0, size, whole: true }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

// ---------------------------------------------------------------------------
// Revision + cursor
// ---------------------------------------------------------------------------

/** A cheap hash of every entry's identity. */
function identityHash(entries: readonly ThreadTranscriptEntry[]): string {
  let hash = 2166136261
  for (const entry of entries) {
    const identity = `${String(entry.id ?? "")}|${String(entry.timestamp ?? "")}`
    for (let index = 0; index < identity.length; index += 1) {
      hash ^= identity.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return (hash >>> 0).toString(36)
}

/**
 * Content revision a cursor is bound to: the entry count plus the hash of
 * every entry's identity. An append changes the count, a rewrite changes an
 * entry identity, and a truncation changes both - each invalidates the cursor
 * instead of silently re-slicing a different transcript.
 */
function revisionOf(entries: readonly ThreadTranscriptEntry[]): string {
  return `${entries.length}.${identityHash(entries)}`
}

/**
 * The revision of a window read from the file's end: the file's size plus the hash of the window's identities. An
 * append or a truncation changes the size, a rewrite inside the window an identity; a same-length rewrite of older
 * entries leaves the window, and so every position the cursor names, unchanged.
 */
function tailRevisionOf(tail: LoadedTail): string {
  return `${tail.size}.${identityHash(tail.entries)}`
}

/**
 * `forward` continues after `offset` (page mode); `older` pages the entries of a tail window before `before`, down to
 * the window's first entry `floor` (the cursor a tail read issues, #14173); `file_tail` does the same for a window
 * read from the session file's end, whose `count` entries the next page reads again and whose positions count from
 * that window's first entry (#14418).
 */
type Cursor =
  | { readonly direction: "forward"; readonly revision: string; readonly offset: number }
  | { readonly direction: "older"; readonly revision: string; readonly before: number; readonly floor: number }
  | { readonly direction: "file_tail"; readonly revision: string; readonly before: number; readonly count: number }

function encodeCursor(cursor: Cursor): string {
  const text =
    cursor.direction === "forward"
      ? `${CURSOR_VERSION}:${cursor.revision}:${cursor.offset}`
      : cursor.direction === "older"
        ? `${OLDER_CURSOR_VERSION}:${cursor.revision}:${cursor.before}:${cursor.floor}`
        : `${FILE_TAIL_CURSOR_VERSION}:${cursor.revision}:${cursor.before}:${cursor.count}`
  return Buffer.from(text, "utf8").toString("base64url")
}

function decodeCursor(raw: string): Cursor | null {
  if (typeof raw !== "string" || raw.length === 0) return null
  let decoded: string
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8")
  } catch {
    return null
  }
  const [version, revision = "", ...positions] = decoded.split(":")
  if (!/^\d+\.[0-9a-z]+$/.test(revision)) return null
  const offsets = positions.map(Number)
  if (offsets.some((offset) => !Number.isSafeInteger(offset) || offset < 0)) return null
  const [first = 0, second = 0] = offsets
  if (version === CURSOR_VERSION && offsets.length === 1) return { direction: "forward", revision, offset: first }
  if (version === OLDER_CURSOR_VERSION && offsets.length === 2 && second <= first)
    return { direction: "older", revision, before: first, floor: second }
  if (version === FILE_TAIL_CURSOR_VERSION && offsets.length === 2 && first <= second && second > 0)
    return { direction: "file_tail", revision, before: first, count: second }
  return null
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Read one bounded slice of a session transcript.
 *
 * `status` returns metadata only, `tail` returns the newest of the last N
 * entries that fit the budget, and `page` continues from an opaque cursor:
 * forward after the last returned entry, or, from a tail read's cursor, the
 * older entries of its window. Truncation is a budget outcome, not a failure:
 * the payload comes back with `truncated: true` and a `next_cursor`.
 */
export function readTranscript(source: ThreadReadSourceRef, opts: ThreadReadOptions = {}): ThreadTranscriptReadResult {
  const mode: ThreadReadMode = opts.mode ?? "tail"
  if (mode !== "status" && mode !== "tail" && mode !== "page") {
    return fail(
      "invalid_arguments",
      `Unknown read mode "${String(mode)}".`,
      'Retry with mode set to "status", "tail", or "page", or call thread_list (tool.thread_list() in an eval cell) to confirm the thread first.',
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
        "Re-read the thread without a cursor to get a fresh next_cursor, or call thread_list (tool.thread_list() in an eval cell) to confirm the thread address.",
      )
    }
  }

  const stale = (): ThreadTranscriptReadResult =>
    fail(
      "cursor_stale",
      "The transcript changed after this cursor was issued, so its position no longer names the same entries.",
      "Re-read the thread without a cursor to restart from a current revision.",
    )
  const missing = (path: string): ThreadTranscriptReadResult =>
    fail(
      "not_found",
      `No session transcript exists at ${path}.`,
      "Call thread_list (tool.thread_list() in an eval cell) to get a current thread value, then read that thread instead.",
    )

  // A session file's tail window, or a page of one, reads only the window from the file's end (#14418).
  const fileTail = cursor?.direction === "file_tail" ? cursor : undefined
  if (source.kind === "jsonl" && (mode === "tail" || fileTail !== undefined)) {
    const tail = loadJsonlTail(source.path, fileTail?.count ?? tailItems)
    if (tail === "missing") return missing(source.path)
    const revision = tailRevisionOf(tail)
    if (fileTail !== undefined && (fileTail.revision !== revision || tail.entries.length !== fileTail.count))
      return stale()
    const end = fileTail?.before ?? tail.entries.length
    const { selected, encodedBytes } = takeWithinBudget(tail.entries.slice(0, end), maxBytes, "end")
    const start = end - selected.length
    return {
      kind: "ok",
      source: "session_jsonl",
      source_incomplete: source.live_host_present !== true,
      mode,
      items: selected,
      total_items: tail.whole ? tail.entries.length : null,
      truncated: start > 0,
      next_cursor:
        start > 0
          ? encodeCursor({ direction: "file_tail", revision, before: start, count: tail.entries.length })
          : null,
      encoded_bytes: encodedBytes,
      max_bytes: maxBytes,
      skipped_lines: tail.skippedLines,
    }
  }
  if (fileTail !== undefined) return stale()

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
    if (file === "missing") return missing(source.path)
    loaded = file
  }

  const entries = loaded.entries
  const revision = revisionOf(entries)

  if (cursor !== null && cursor.revision !== revision) return stale()

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

  const older = mode === "page" && cursor?.direction === "older" ? cursor : undefined
  if (mode === "page" && older === undefined) {
    const start = cursor?.direction === "forward" ? cursor.offset : 0
    const { selected, encodedBytes } = takeWithinBudget(entries.slice(start), maxBytes)
    const nextOffset = start + selected.length
    const truncated = nextOffset < entries.length
    return {
      ...base,
      items: selected,
      truncated,
      next_cursor: truncated ? encodeCursor({ direction: "forward", revision, offset: nextOffset }) : null,
      encoded_bytes: encodedBytes,
    }
  }

  // A tail window, or the older part of one, filled from its newest entry backward, so a first read always ends at the
  // latest entry whatever the budget (#14173).
  const floor = older?.floor ?? Math.max(0, entries.length - tailItems)
  const end = older?.before ?? entries.length
  const { selected, encodedBytes } = takeWithinBudget(entries.slice(floor, end), maxBytes, "end")
  const start = end - selected.length
  const truncated = start > floor
  return {
    ...base,
    items: selected,
    truncated,
    next_cursor: truncated ? encodeCursor({ direction: "older", revision, before: start, floor }) : null,
    encoded_bytes: encodedBytes,
  }
}
