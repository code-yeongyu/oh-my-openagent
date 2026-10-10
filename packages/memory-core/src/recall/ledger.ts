// Session recall ledger: tracks which memory paths were already surfaced in a
// session so the same hint never repeats. One JSON file per session under the
// ledger directory; reads fail closed (missing or malformed yields an empty
// set) and writes are atomic .tmp -> rename at mode 0o600, following the
// facts/soul durability conventions.

import { mkdir, readFile, rename, stat, writeFile } from "../fs/resilient"
import { join } from "node:path"

export const RECALL_LEDGER_VERSION = 1

const SESSION_FILENAME_MAX_LENGTH = 80
const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]+/g

export interface RecallSurfacedEntry {
  readonly path: string
  readonly hash: string
}

export interface RecallLedgerFile {
  readonly version: typeof RECALL_LEDGER_VERSION
  readonly surfaced: Readonly<Record<string, { readonly hash: string; readonly at: string }>>
}

/**
 * Windows-safe, colon-free session filename component. Path separators, glob
 * metacharacters and control characters collapse to dashes; degenerate results
 * (".", "..", empty) fall back to "session".
 */
export function sanitizeSessionFilename(sessionId: string): string {
  const sanitized = sessionId
    .replace(UNSAFE_FILENAME_CHARS, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SESSION_FILENAME_MAX_LENGTH)
    .replace(/-+$/g, "")
  if (sanitized === "" || sanitized === "." || sanitized === "..") return "session"
  return sanitized
}

const EMPTY_LEDGER: RecallLedgerFile = { version: RECALL_LEDGER_VERSION, surfaced: {} }

/**
 * Stat-gated parse cache keyed by session file path. Recall asks for the surfaced set on every
 * prompt and every tool call (#8335), while the writers (kibitzer delivery, recall drain) live in
 * this process and update the entry as they write. A cross-process writer is still observed: the
 * cached (mtimeMs,size) is compared against a fresh stat before the parsed value is reused, and the
 * cache is keyed by path so instances sharing a ledger directory share the entry.
 */
interface LedgerCacheEntry {
  readonly mtimeMs: number
  readonly size: number
  readonly file: RecallLedgerFile
}

const LEDGER_CACHE = new Map<string, LedgerCacheEntry>()
const MAX_CACHED_LEDGERS = 32

let ledgerDiskReads = 0

/** Diagnostic: session-ledger files parsed from disk since process start (asserted in tests). */
export function recallLedgerDiskReads(): number {
  return ledgerDiskReads
}

function rememberLedger(path: string, mtimeMs: number, size: number, file: RecallLedgerFile): void {
  LEDGER_CACHE.delete(path)
  LEDGER_CACHE.set(path, { mtimeMs, size, file })
  while (LEDGER_CACHE.size > MAX_CACHED_LEDGERS) {
    const oldest = LEDGER_CACHE.keys().next()
    if (oldest.done === true) break
    LEDGER_CACHE.delete(oldest.value)
  }
}

export class RecallLedger {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  async surfacedPaths(sessionId: string): Promise<Set<string>> {
    const ledger = await this.read(sessionId)
    return new Set(Object.keys(ledger.surfaced))
  }

  async markSurfaced(sessionId: string, entries: readonly RecallSurfacedEntry[]): Promise<void> {
    if (entries.length === 0) return

    const current = await this.read(sessionId)
    const surfaced: Record<string, { hash: string; at: string }> = { ...current.surfaced }
    const at = new Date().toISOString()
    for (const entry of entries) {
      surfaced[entry.path] = { hash: entry.hash, at }
    }

    const target = this.sessionFilePath(sessionId)
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const temporary = `${target}.tmp-${process.pid}`
    const written: RecallLedgerFile = { version: RECALL_LEDGER_VERSION, surfaced }
    await writeFile(temporary, `${JSON.stringify(written, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, target)
    // Own write: adopt the value just persisted so the next read skips the file entirely.
    try {
      const info = await stat(target)
      rememberLedger(target, info.mtimeMs, info.size, written)
    } catch {
      LEDGER_CACHE.delete(target)
    }
  }

  private sessionFilePath(sessionId: string): string {
    return join(this.dir, `${sanitizeSessionFilename(sessionId)}.json`)
  }

  private async read(sessionId: string): Promise<RecallLedgerFile> {
    const target = this.sessionFilePath(sessionId)
    let mtimeMs: number
    let size: number
    try {
      const info = await stat(target)
      mtimeMs = info.mtimeMs
      size = info.size
    } catch {
      LEDGER_CACHE.delete(target)
      return EMPTY_LEDGER
    }
    const cached = LEDGER_CACHE.get(target)
    if (cached !== undefined && cached.mtimeMs === mtimeMs && cached.size === size) return cached.file

    // The stat is taken BEFORE the read: a write landing in between yields content newer than the
    // recorded stat, which the next stat comparison re-reads. The reverse order would cache stale
    // content under the new stat and never notice.
    let raw: string
    try {
      ledgerDiskReads += 1
      raw = await readFile(target, "utf8")
    } catch {
      LEDGER_CACHE.delete(target)
      return EMPTY_LEDGER
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      const empty = EMPTY_LEDGER
      rememberLedger(target, mtimeMs, size, empty)
      return empty
    }
    const file = parseLedgerFile(parsed) ?? EMPTY_LEDGER
    rememberLedger(target, mtimeMs, size, file)
    return file
  }
}

function parseLedgerFile(value: unknown): RecallLedgerFile | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.version !== RECALL_LEDGER_VERSION) return undefined
  if (record.surfaced === null || typeof record.surfaced !== "object" || Array.isArray(record.surfaced)) {
    return undefined
  }
  return { version: RECALL_LEDGER_VERSION, surfaced: record.surfaced as RecallLedgerFile["surfaced"] }
}
