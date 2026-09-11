// Session recall ledger: tracks which memory paths were already surfaced in a
// session so the same hint never repeats. One JSON file per session under the
// ledger directory; reads fail closed (missing or malformed yields an empty
// set) and writes are atomic .tmp -> rename at mode 0o600, following the
// facts/soul durability conventions.

import { mkdir, readFile, rename, writeFile } from "../fs/resilient"
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
    await writeFile(
      temporary,
      `${JSON.stringify({ version: RECALL_LEDGER_VERSION, surfaced }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    )
    await rename(temporary, target)
  }

  private sessionFilePath(sessionId: string): string {
    return join(this.dir, `${sanitizeSessionFilename(sessionId)}.json`)
  }

  private async read(sessionId: string): Promise<RecallLedgerFile> {
    let raw: string
    try {
      raw = await readFile(this.sessionFilePath(sessionId), "utf8")
    } catch {
      return EMPTY_LEDGER
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return EMPTY_LEDGER
    }
    return parseLedgerFile(parsed) ?? EMPTY_LEDGER
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
