// What a retention pass removed (#12932): one JSON line per pass that removed anything, appended to
// `runtime/retention-log.jsonl`. A pass that removes nothing writes nothing, so a visit of an identity
// with nothing to remove still leaves its mtimes alone (the transient sweep reads them). The log is
// bounded: past `maxBytes` the file becomes `retention-log.1.jsonl` (one previous generation) before the
// next line is written; each store lists at most `maxNamesPerStore` names with the rest counted, fewer when
// needed to keep one line within 32 KiB, so the doctors' 64 KiB tail always holds the newest whole line.
// The log is a record, not state: no pass reads it, and the doctors read only its last entry.

import { join } from "node:path"

import { appendFile, open, rename, stat } from "../fs/resilient"
import { errorCode } from "./policy"

export const RETENTION_LOG_FILE = "retention-log.jsonl"
export const RETENTION_LOG_PREVIOUS_FILE = "retention-log.1.jsonl"
const DEFAULT_MAX_BYTES = 512 * 1024
const DEFAULT_MAX_NAMES_PER_STORE = 200
/** Half the reader's tail, so the newest whole line always fits in it. */
const MAX_LINE_BYTES = 32 * 1024
/** The doctors read this much of the log's end for the last entry. */
const TAIL_BYTES = 64 * 1024

export interface RetentionLogInput {
  /** Pass time, epoch ms. */
  readonly at: number
  /** Names the pass deleted, per store (`runs`, `journals`, `cap:<tier>`, ...); empty stores are left out. */
  readonly removed: Readonly<Record<string, readonly string[]>>
  /** Bytes the size cap evicted, when it evicted anything. */
  readonly capEvictedBytes?: number
}

export interface RetentionLogEntry {
  /** ISO time of the pass. */
  readonly at: string
  /** Items the pass removed, every store together. */
  readonly total: number
}

export async function appendRetentionLog(
  runtimeDir: string,
  input: RetentionLogInput,
  limits: { readonly maxBytes?: number; readonly maxNamesPerStore?: number } = {},
): Promise<void> {
  const stores = Object.entries(input.removed).filter(([, names]) => names.length > 0)
  const total = stores.reduce((sum, [, names]) => sum + names.length, 0)
  if (total === 0) return
  // Fewer names per store until the line fits; the counts stay exact in `total` and `more`.
  let line = ""
  for (let maxNames = limits.maxNamesPerStore ?? DEFAULT_MAX_NAMES_PER_STORE; ; maxNames = Math.floor(maxNames / 2)) {
    line = formatLine(input, total, stores, maxNames)
    if (Buffer.byteLength(line) <= MAX_LINE_BYTES || maxNames === 0) break
  }
  const path = join(runtimeDir, RETENTION_LOG_FILE)
  const size = await stat(path).then((stats) => stats.size, (error: unknown) => {
    if (errorCode(error) === "ENOENT") return 0
    throw error
  })
  if (size > 0 && size + Buffer.byteLength(line) > (limits.maxBytes ?? DEFAULT_MAX_BYTES)) {
    await rename(path, join(runtimeDir, RETENTION_LOG_PREVIOUS_FILE))
  }
  // One append of one whole line: a crash leaves at most a torn last line, which the reader skips.
  await appendFile(path, line, { encoding: "utf8", mode: 0o600 })
}

function formatLine(input: RetentionLogInput, total: number, stores: readonly (readonly [string, readonly string[]])[], maxNames: number): string {
  const removed: Record<string, readonly string[]> = {}
  const more: Record<string, number> = {}
  for (const [store, names] of stores) {
    removed[store] = names.slice(0, maxNames)
    if (names.length > maxNames) more[store] = names.length - maxNames
  }
  return `${JSON.stringify({
    v: 1,
    at: new Date(input.at).toISOString(),
    total,
    removed,
    ...(Object.keys(more).length === 0 ? {} : { more }),
    ...(input.capEvictedBytes === undefined || input.capEvictedBytes === 0 ? {} : { capEvictedBytes: input.capEvictedBytes }),
  })}\n`
}

/** The newest whole entry of the log, else of the previous generation; undefined when neither has one. */
export async function readLastRetentionLogEntry(runtimeDir: string): Promise<RetentionLogEntry | undefined> {
  for (const file of [RETENTION_LOG_FILE, RETENTION_LOG_PREVIOUS_FILE]) {
    const entry = lastEntry(await readTail(join(runtimeDir, file)))
    if (entry !== undefined) return entry
  }
  return undefined
}

async function readTail(path: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, "r")
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return ""
    throw error
  }
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString("utf8")
  } finally {
    await handle.close()
  }
}

function lastEntry(tail: string): RetentionLogEntry | undefined {
  const lines = tail.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined || line === "") continue
    let parsed: { readonly at?: unknown; readonly total?: unknown }
    try {
      parsed = JSON.parse(line) as typeof parsed
    } catch {
      continue
    }
    if (typeof parsed.at === "string" && typeof parsed.total === "number") return { at: parsed.at, total: parsed.total }
  }
  return undefined
}
