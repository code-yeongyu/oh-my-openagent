// Kibitzer output contract: the resident in-process sidecar speaks only through the nudge
// tool, whose closure records each accepted nudge against the paths it was offered. The parent is
// authoritative: every collected nudge is re-validated against the candidate set, the session
// ledger, the hint shape and the configured cap (defence in depth - the closure already
// enforced the same rules at call time).
//
// Accepted nudges wait in a per-session pending file until the next turn injects
// them. The payload is self-describing ({ version, sessionId, writtenAt, nudges })
// so a filename collision from session-id sanitization can never hand one session
// another session's nudges, and so a payload nobody consumed expires instead of
// surfacing days later. A compaction retracts the session's payload through
// `delete` at the moment it is accepted; nothing is stamped on the payload for it.

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "../fs/resilient"
import { join } from "node:path"

import { sanitizeSessionFilename } from "./ledger"
import { containsSecretLikeMaterial } from "../sync/redact"

export const PENDING_NUDGES_VERSION = 1

/** Hint budget: one factual sentence. Internal, deliberately not a config knob. */
export const NUDGE_HINT_MAX_CHARS = 200

/** Decision commentary is not a memory fact. Internal, deliberately not a config knob. */
const NUDGE_DECISION_LANGUAGE_PATTERN = /\b(?:no\s+stored\s+memory|clears\s+the\s+bar|not?\s+relevant|memor(?:y|ies)\s+(?:(?:is|are)\s+(?:unrelated\s+to|not\s+about)|(?:does|do)\s+not\s+(?:cover|address|pertain))|memor(?:y|ies)\s+covers?\s+.*\s+not\s+the)\b/i

/** Pending payloads older than this are junk from an abandoned session. */
const PENDING_TTL_MS = 24 * 60 * 60_000

const TMP_PREFIX_PATTERN = /\.tmp-/

export interface RecallNudge {
  readonly path: string
  readonly hint: string
}

export interface PendingNudgesFile {
  readonly version: typeof PENDING_NUDGES_VERSION
  readonly sessionId: string
  readonly writtenAt: string
  readonly nudges: readonly RecallNudge[]
}

export interface ValidateNudgesOptions {
  /** Paths the parent offered the sidecar (or its read-only memory search returned); anything else is fabricated. */
  readonly candidates: ReadonlySet<string>
  /** Paths already surfaced in this session; they never repeat. */
  readonly surfaced: ReadonlySet<string>
  /** Authoritative cap from config (memory.recall.max_items). */
  readonly maxItems: number
}

/**
 * Hint budget predicate, shared with the in-process sidecar's nudge tool: one factual sentence,
 * non-empty, at most `NUDGE_HINT_MAX_CHARS`, on a single line, without nudge-decision commentary.
 */
export function isValidHint(hint: string): boolean {
  if (hint.length === 0 || hint.length > NUDGE_HINT_MAX_CHARS) return false
  return !/[\r\n]/.test(hint) && !NUDGE_DECISION_LANGUAGE_PATTERN.test(hint)
}

/**
 * Parse the nudge NDJSON file fail-closed per line: an unparsable or
 * non-conforming line is dropped and the remaining lines still count.
 */

/**
 * Parent-side validation of sidecar output. Order is preserved so the cap keeps
 * the sidecar's own priority.
 */
export function validateNudges(
  nudges: readonly RecallNudge[],
  options: ValidateNudgesOptions,
): RecallNudge[] {
  const maxItems = Math.max(0, options.maxItems)
  if (maxItems === 0) return []

  const accepted: RecallNudge[] = []
  const seen = new Set<string>()
  for (const nudge of nudges) {
    if (accepted.length >= maxItems) break
    if (seen.has(nudge.path)) continue
    if (!options.candidates.has(nudge.path)) continue
    if (options.surfaced.has(nudge.path)) continue
    if (!isValidHint(nudge.hint)) continue
    seen.add(nudge.path)
    accepted.push({ path: nudge.path, hint: nudge.hint })
  }
  return accepted
}

/**
 * Pending nudge handoff store: one JSON file per session under the pending
 * directory. Writes are atomic .tmp -> rename at mode 0o600; reads fail closed
 * (missing, malformed, foreign session or expired yields no nudges).
 */
export class PendingNudges {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  async write(sessionId: string, nudges: readonly RecallNudge[]): Promise<void> {
    if (nudges.length === 0) return

    const target = this.sessionFilePath(sessionId)
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    await this.prune(target)
    const payload: PendingNudgesFile = {
      version: PENDING_NUDGES_VERSION,
      sessionId,
      writtenAt: new Date().toISOString(),
      nudges: nudges.map((nudge) => ({ path: nudge.path, hint: nudge.hint })),
    }
    const temporary = `${target}.tmp-${process.pid}`
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, target)
  }

  /**
   * Consume the session's pending nudges. The embedded sessionId must match:
   * a mismatch means a sanitized-filename collision, so the file is left for its
   * real owner. An expired payload is dropped and deleted.
   */
  async take(sessionId: string): Promise<RecallNudge[]> {
    const target = this.sessionFilePath(sessionId)
    let raw: string
    try {
      raw = await readFile(target, "utf8")
    } catch {
      return []
    }

    const payload = parsePendingFile(raw)
    if (payload === undefined) {
      await removeQuietly(target)
      return []
    }
    if (payload.sessionId !== sessionId) return []

    await removeQuietly(target)
    const writtenAt = Date.parse(payload.writtenAt)
    if (!Number.isFinite(writtenAt) || Date.now() - writtenAt > PENDING_TTL_MS) return []
    return payload.nudges.map((nudge) => ({ path: nudge.path, hint: nudge.hint }))
  }

  /**
   * Targeted retraction of one session's payload: delivery retracts its own file once every held
   * nudge is delivered, and a compaction retracts the session's file at the moment it is accepted.
   * The embedded sessionId is verified exactly as take() verifies it: sanitizeSessionFilename maps
   * distinct session ids onto one filename, so an unguarded unlink would let one session retract
   * another session's nudges. A mismatch leaves the file for its real owner. Best-effort otherwise,
   * like every other pending-file removal.
   */
  async delete(sessionId: string): Promise<void> {
    const target = this.sessionFilePath(sessionId)
    let raw: string
    try {
      raw = await readFile(target, "utf8")
    } catch {
      return
    }
    const payload = parsePendingFile(raw)
    // An unparsable file belongs to nobody: removing it is the same hygiene take() applies.
    if (payload !== undefined && payload.sessionId !== sessionId) return
    await removeQuietly(target)
  }

  private sessionFilePath(sessionId: string): string {
    return join(this.dir, `${sanitizeSessionFilename(sessionId)}.json`)
  }

  /** Best-effort sweep of abandoned sibling payloads and .tmp-* orphans. */
  private async prune(currentTarget: string): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return
    }
    const cutoff = Date.now() - PENDING_TTL_MS
    for (const name of names) {
      const candidate = join(this.dir, name)
      if (candidate === currentTarget) continue
      if (!name.endsWith(".json") && !TMP_PREFIX_PATTERN.test(name)) continue
      try {
        const stats = await stat(candidate)
        if (stats.mtimeMs > cutoff) continue
      } catch {
        continue
      }
      await removeQuietly(candidate)
    }
  }
}

function parseNudge(value: unknown): RecallNudge | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const { path, hint } = record
  if (typeof path !== "string" || path.length === 0) return undefined
  if (typeof hint !== "string" || hint.length === 0) return undefined
  if (!isValidHint(hint) || containsSecretLikeMaterial(hint)) return undefined
  return { path, hint }
}

function parsePendingFile(raw: string): PendingNudgesFile | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.version !== PENDING_NUDGES_VERSION) return undefined
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) return undefined
  if (typeof record.writtenAt !== "string") return undefined
  if (!Array.isArray(record.nudges)) return undefined
  const nudges: RecallNudge[] = []
  for (const entry of record.nudges) {
    const nudge = parseNudge(entry)
    if (nudge === undefined) return undefined
    nudges.push(nudge)
  }
  return {
    version: PENDING_NUDGES_VERSION,
    sessionId: record.sessionId,
    writtenAt: record.writtenAt,
    nudges,
  }
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { force: true })
  } catch {
    // Fail-open: a stuck pending file must never break the turn.
  }
}
