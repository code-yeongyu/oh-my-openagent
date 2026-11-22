import { createHash } from "node:crypto"
import { closeSync, fstatSync, openSync, readSync, statSync, type Stats } from "node:fs"
import { THREAD_READ_MAX_BYTES } from "./contracts"
import type { ThreadTranscriptEntry } from "./reader"

/**
 * One JSONL line as an entry. A line that is not a JSON object - malformed syntax, a bare scalar, or a run of non-UTF8
 * bytes decoded to replacement characters - is `skipped`; a blank line is `blank` and not counted.
 */
export function parseLine(line: string): ThreadTranscriptEntry | "skipped" | "blank" {
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

/** A recovery walk binds positions to this file, including same-size writes between pages. */
export function fileRevision(stat: Stats): string {
  return `${stat.size}.${createHash("sha256").update(`${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}`).digest("hex")}`
}

/** Both directions choose at most 1 MiB from metadata before opening the transcript. */
export function readFileWindow<T>(
  path: string,
  offset: number | "tail",
  read: (descriptor: number, snapshot: Stats, start: number, end: number) => T,
): T | "missing" | "changed" {
  let snapshot: Stats
  try {
    snapshot = statSync(path)
  } catch {
    return "missing"
  }
  if (!snapshot.isFile()) return "missing"
  const start = offset === "tail" ? Math.max(0, snapshot.size - THREAD_READ_MAX_BYTES) : offset
  const end = Math.min(start + THREAD_READ_MAX_BYTES, snapshot.size)
  if (start > end) return "changed"
  let descriptor: number
  try {
    descriptor = openSync(path, "r")
  } catch {
    return "missing"
  }
  try {
    const opened = fstatSync(descriptor)
    if (
      opened.size !== snapshot.size ||
      opened.dev !== snapshot.dev ||
      opened.ino !== snapshot.ino ||
      opened.ctimeMs !== snapshot.ctimeMs
    )
      return "changed"
    return read(descriptor, snapshot, start, end)
  } catch {
    return "changed"
  } finally {
    closeSync(descriptor)
  }
}

export function readRange(descriptor: number, position: number, length: number): Buffer {
  const chunk = Buffer.allocUnsafe(length)
  let read = 0
  while (read < length) {
    const got = readSync(descriptor, chunk, read, length - read, position + read)
    if (got === 0) throw new Error("session file truncated during the read")
    read += got
  }
  return chunk
}

export type FileScanCursor = {
  readonly direction: "file_scan"
  readonly revision: string
  readonly offset: number
  readonly skip: boolean
}

/** Start at a line boundary, or discard the remaining fragments of a line known to exceed the scan ceiling. */
export function readRecoveryPage(path: string, cursor: FileScanCursor, count: number, budget: number) {
  return readFileWindow(path, cursor.offset, (fd, stat, start, end) => {
    if (fileRevision(stat) !== cursor.revision) return "changed" as const
    const chunk = readRange(fd, start, end - start)
    const items: ThreadTranscriptEntry[] = []
    let encodedBytes = 0
    let skippedLines = 0
    let skip = cursor.skip
    let pos = 0
    while (pos < chunk.length && items.length < count) {
      const nl = chunk.indexOf(0x0a, pos)
      if (nl < 0 && end < stat.size) {
        // Give a split record a whole window on the next call. Only skip it once it cannot fit even then.
        if (pos === 0 || skip) {
          if (!skip) skippedLines++
          skip = true
          pos = chunk.length
        }
        break
      }
      const stop = nl < 0 ? chunk.length : nl
      if (!skip) {
        const entry = parseLine(chunk.toString("utf8", pos, stop))
        if (entry === "skipped") skippedLines++
        else if (entry !== "blank") {
          const bytes = Buffer.byteLength(JSON.stringify(entry))
          if (bytes > budget) skippedLines++
          else {
            if (encodedBytes + bytes > budget) break
            items.push(entry)
            encodedBytes += bytes
          }
        }
      }
      skip = false
      pos = nl < 0 ? stop : stop + 1
    }
    const offset = start + pos
    return { items, encodedBytes, skippedLines, next: offset < stat.size ? { ...cursor, offset, skip } : null }
  })
}
