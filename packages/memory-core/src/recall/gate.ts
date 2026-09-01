// Memorian gate output contract: the judge child speaks only through the nudge
// tool, which appends NDJSON {path, hint} lines. The parent is authoritative:
// every line is re-parsed fail-closed (a malformed line drops, never poisons the
// batch, following parseFactsExtractionJsonl's precedent inverted to skip
// instead of throw) and re-validated against the candidate set, the session
// ledger, the hint shape and the configured cap.
//
// Accepted nudges wait in a per-session pending file until the next turn injects
// them. The payload is self-describing ({ version, sessionId, compactionEpoch,
// writtenAt, nudges }) so a filename collision from session-id sanitization can
// never hand one session another session's nudges, so a payload nobody consumed
// expires instead of surfacing days later, and so a verdict about a transcript a
// compaction has since rewritten is rejected AT CONSUMPTION rather than raced
// against by the writer.

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "../fs/resilient"
import { join } from "node:path"

import { sanitizeSessionFilename } from "./ledger"

export const PENDING_NUDGES_VERSION = 1

/** Hint budget: one factual sentence. Internal, deliberately not a config knob. */
export const NUDGE_HINT_MAX_CHARS = 200

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
  /**
   * The session's compaction epoch when the judge's verdict was written. A payload is only valid
   * while the live epoch still equals it: any bump means the judged transcript was replaced.
   * Absent only in pre-release payloads, which take() therefore treats as stale.
   */
  readonly compactionEpoch?: number
  readonly writtenAt: string
  readonly nudges: readonly RecallNudge[]
}

export interface PendingNudgesWriteOptions {
  /** The session's compaction epoch as captured by the launch that produced these nudges. */
  readonly epoch: number
}

export interface PendingNudgesTakeOptions {
  /** The session's live compaction epoch, read by the consumer at injection time. */
  readonly currentEpoch: number
}

export interface ValidateNudgesOptions {
  /** Paths the parent offered the judge this turn; anything else is fabricated. */
  readonly candidates: ReadonlySet<string>
  /** Paths already surfaced in this session; they never repeat. */
  readonly surfaced: ReadonlySet<string>
  /** Authoritative cap from config (memory.recall.max_items). */
  readonly maxItems: number
}

/**
 * Parse the nudge NDJSON file fail-closed per line: an unparsable or
 * non-conforming line is dropped and the remaining lines still count.
 */
export function parseNudgeLines(raw: string): RecallNudge[] {
  const nudges: RecallNudge[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    const nudge = parseNudge(value)
    if (nudge !== undefined) nudges.push(nudge)
  }
  return nudges
}

/**
 * Parent-side validation of judge output. Order is preserved so the cap keeps
 * the judge's own priority.
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

  async write(
    sessionId: string,
    nudges: readonly RecallNudge[],
    options: PendingNudgesWriteOptions,
  ): Promise<void> {
    if (nudges.length === 0) return

    const target = this.sessionFilePath(sessionId)
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    await this.prune(target)
    const payload: PendingNudgesFile = {
      version: PENDING_NUDGES_VERSION,
      sessionId,
      compactionEpoch: options.epoch,
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
   *
   * Staleness is decided HERE, not by the writer. A compaction accepted at any
   * point after the judge started - including inside the writer's own
   * mkdir/prune/write/rename window - bumps the session's epoch, so a payload
   * stamped with anything but the live epoch judged a transcript that no longer
   * exists and is deleted unread. That makes correctness independent of who wins
   * the write-versus-compaction race. An epoch-less payload can only come from a
   * pre-release write and is treated the same way.
   */
  async take(sessionId: string, options: PendingNudgesTakeOptions): Promise<RecallNudge[]> {
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
    if (payload.compactionEpoch !== options.currentEpoch) return []
    const writtenAt = Date.parse(payload.writtenAt)
    if (!Number.isFinite(writtenAt) || Date.now() - writtenAt > PENDING_TTL_MS) return []
    return payload.nudges.map((nudge) => ({ path: nudge.path, hint: nudge.hint }))
  }

  /**
   * Targeted retraction of one session's payload, for a writer dropping its own just-written file.
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

function isValidHint(hint: string): boolean {
  if (hint.length === 0 || hint.length > NUDGE_HINT_MAX_CHARS) return false
  return !/[\r\n]/.test(hint)
}

function parseNudge(value: unknown): RecallNudge | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const { path, hint } = record
  if (typeof path !== "string" || path.length === 0) return undefined
  if (typeof hint !== "string" || hint.length === 0) return undefined
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
  if (record.compactionEpoch !== undefined && typeof record.compactionEpoch !== "number") return undefined
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
    ...(record.compactionEpoch === undefined ? {} : { compactionEpoch: record.compactionEpoch }),
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
