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
 * (a seat transcript reaches hundreds of MB, #14418). Tail windows scan at most
 * 1 MiB, chosen before opening the file; status only stats it. Recovery cursors scan forward one bounded window per call. Legacy forward pages
 * retain the whole-file loader. Entries are encoded until the byte budget is spent, and the caller
 * receives ONE payload plus an opaque cursor. Nothing streams into the caller.
 *
 * Failures are data (authoring rules R6/R7): every error branch is
 * `{ kind: "error", error: { code, message, next_action } }` with a
 * `next_action` that names thread_list or the re-read to run, and nothing in
 * this module throws for an expected failure.
 */

import { createHash } from "node:crypto"
import { closeSync, openSync, readSync, statSync, type Stats } from "node:fs"
import { StringDecoder } from "node:string_decoder"

import {
  decodeTranscriptCursor,
  encodeTranscriptCursor,
  THREAD_TAIL_MAX_ITEMS,
  type TranscriptCursor,
} from "../../../../omo-native/bin/lib/thread-read-cursor.js"
import { THREAD_READ_DEFAULT_BYTES, THREAD_READ_MAX_BYTES, type ThreadReadSource } from "./contracts"
import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "./errors"
import { fileRevision, parseLine, readFileWindow, readRange, readRecoveryPage } from "./reader-file-window"
import { takeWithinBudget } from "./read-budget"

export { decodeTranscriptCursor }

/** Default number of trailing entries a tail read returns. */
export const THREAD_TAIL_DEFAULT_ITEMS = 60
/** Hard ceiling on a tail request; a larger `tail_items` is invalid_arguments. */
export { THREAD_TAIL_MAX_ITEMS }

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** A raw JSONL entry object, handed back unmodified. */
export type ThreadTranscriptEntry = { readonly [key: string]: JsonValue }

/** The message a public file read can render, or undefined for session bookkeeping. */
export function sessionMessage(entry: ThreadTranscriptEntry): ThreadTranscriptEntry | undefined {
  const message = entry.message
  if (entry.type !== "message" || typeof message !== "object" || message === null || Array.isArray(message))
    return undefined
  return message.role === "user" || message.role === "assistant" || message.role === "toolResult" ? message : undefined
}

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
   * stopped before the file's start, or status did not load the entries.
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
  readonly snapshot: Stats
  /** The file's size when it was read: every append, truncation or rewrite of another length changes it. */
  readonly size: number
  /** File identity and the exact lines examined, including skipped lines. */
  readonly hash: string
  /** Whether the read reached the file's first line, so `entries` is the whole transcript. */
  readonly whole: boolean
}

/**
 * The file's last `count` entries, read backward from its end in fixed-size chunks (#14418): the bytes read and the
 * entries parsed follow the window, never the file, so an 840 MB transcript answers like a small one. Lines are split
 * on the newline byte, which never occurs inside a UTF-8 sequence, and each is decoded on its own; a line longer than a
 * chunk is assembled once from its chunks, up to the 1 MiB scan ceiling. An incomplete line at that ceiling is omitted.
 * Only the bytes present when the read starts are read, so an append racing
 * the read is the next read's.
 */
function loadJsonlTail(path: string, count: number): LoadedTail | "missing" | "changed" {
  return readFileWindow(path, "tail", (descriptor, snapshot, floor, size) => {
    const hash = createHash("sha256").update(`${snapshot.dev}:${snapshot.ino}:`)
    const newestFirst: ThreadTranscriptEntry[] = []
    let skippedLines = 0
    const take = (line: Buffer): void => {
      hash.update(line).update("\n")
      const entry = parseLine(line.toString("utf8"))
      if (entry === "skipped") skippedLines += 1
      else if (entry !== "blank") newestFirst.push(entry)
    }
    // The bytes after the newest newline found so far that belong to a line whose start is not read yet, oldest first.
    let pending: Buffer[] = []
    let position = size
    while (newestFirst.length < count && position > floor) {
      const length = Math.min(READ_CHUNK_BYTES, position - floor)
      position -= length
      const chunk = readRange(descriptor, position, length)
      let end = length
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
    return {
      entries: newestFirst.reverse(),
      skippedLines,
      size,
      whole,
      hash: hash.digest("hex"),
      snapshot,
    }
  })
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
 * The revision binds the file size and identity to every examined line in the bounded window. Content, parent links
 * and malformed lines participate, so unchanged entry ids cannot hide a rewrite. Same-length edits outside the window
 * leave the cursor valid.
 */
function tailRevisionOf(tail: LoadedTail): string {
  return `${tail.size}.${tail.hash}`
}

export function invalidReadCursor() {
  return {
    kind: "error" as const,
    error: threadToolFailure(
      "cursor_invalid",
      "The cursor is not a cursor this reader issued.",
      "Re-read the thread without a cursor to get a fresh next_cursor, or call thread_list (tool.thread_list() in an eval cell) to confirm the thread address.",
    ),
  }
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

  let cursor: TranscriptCursor | null = null
  if (opts.cursor !== undefined) {
    cursor = decodeTranscriptCursor(opts.cursor)
    if (cursor === null) {
      return invalidReadCursor()
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

  // Status must never open a transcript, even when a cursor is supplied.
  if (mode === "status") {
    let totalItems: number | null = null
    if (source.kind === "jsonl") {
      try {
        const metadata = statSync(source.path)
        if (!metadata.isFile()) return missing(source.path)
        if (metadata.size === 0) totalItems = 0
      } catch {
        return missing(source.path)
      }
    }
    return {
      kind: "ok",
      source: source.kind === "jsonl" ? "session_jsonl" : "live_host",
      source_incomplete: source.kind === "jsonl" && source.live_host_present !== true,
      mode,
      items: [],
      total_items: totalItems,
      truncated: false,
      next_cursor: null,
      encoded_bytes: 0,
      max_bytes: maxBytes,
      skipped_lines: 0,
    }
  }

  if (cursor?.direction === "file_scan") {
    if (source.kind !== "jsonl") return stale()
    const page = readRecoveryPage(source.path, cursor, tailItems, maxBytes)
    if (page === "missing") return missing(source.path)
    if (page === "changed") return stale()
    return {
      kind: "ok",
      source: "session_jsonl",
      source_incomplete: source.live_host_present !== true,
      mode,
      items: page.items,
      total_items: null,
      truncated: page.next !== null,
      next_cursor: page.next === null ? null : encodeTranscriptCursor(page.next),
      encoded_bytes: page.encodedBytes,
      max_bytes: maxBytes,
      skipped_lines: page.skippedLines,
    }
  }

  // A session file's tail window, or a page of one, reads only the window from the file's end (#14418).
  const fileTail = cursor?.direction === "file_tail" ? cursor : undefined
  if (source.kind === "jsonl" && (mode === "tail" || fileTail !== undefined)) {
    const count = fileTail?.count ?? tailItems
    const tail = loadJsonlTail(source.path, count)
    if (tail === "missing") return missing(source.path)
    if (tail === "changed") return stale()
    const revision = tailRevisionOf(tail)
    if (fileTail !== undefined && (fileTail.revision !== revision || fileTail.before > tail.entries.length))
      return stale()
    if (tail.size > THREAD_READ_MAX_BYTES && !tail.entries.some((entry) => sessionMessage(entry) !== undefined))
      return {
        kind: "error",
        error: threadToolFailure(
          "message_too_large",
          "No complete transcript message was found in the 1 MiB tail scan window.",
          "In an eval cell, call tool.thread_read({ thread: thread, cursor: error.details.next_cursor }) with the same thread, then follow next_cursor until absent.",
          {
            next_cursor: encodeTranscriptCursor({
              direction: "file_scan",
              revision: fileRevision(tail.snapshot),
              offset: 0,
              skip: false,
            }),
          },
        ),
      }
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
        start > 0 ? encodeTranscriptCursor({ direction: "file_tail", revision, before: start, count }) : null,
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
      next_cursor: truncated ? encodeTranscriptCursor({ direction: "forward", revision, offset: nextOffset }) : null,
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
    next_cursor: truncated ? encodeTranscriptCursor({ direction: "older", revision, before: start, floor }) : null,
    encoded_bytes: encodedBytes,
  }
}
