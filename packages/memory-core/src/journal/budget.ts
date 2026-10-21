// Transcript storage budget (the steady-state size bound for <runtime>/transcripts).
//
// Three passes over the journals of one identity, each journal handled on its own under its lock:
//   1. retire  - journals reflection has fully consumed, idle for `retireIdleMs` (default 7 days);
//   2. evict   - while the directory is still over `budgetBytes` (default 32 MiB), the least recently
//                active journals idle for `evictIdleMs` (default 24 h), consumed or not. Unreflected rows
//                they held are dropped on purpose: memory keeps what can be injected, and a backlog
//                reflection never consumed is not that;
//   3. expire  - retired markers idle for `retiredTtlMs` (default 90 days) are removed outright.
// A live session is never touched, and a conversation whose facts batch is still queued is kept, since
// its watermarks must survive until that batch settles. Nothing here reads a transcript into memory:
// decisions come from file sizes, mtimes and the small state.json, and retirement streams.

import { join } from "node:path"

import { lstat, readFile, readdir, rmdir, unlink } from "../fs/resilient"
import { JournalLockTimeoutError, withLocalJournalLock, type JournalLock } from "./lock"
import { RETIRED_IDS_FILE, retireTranscriptJournal } from "./retire"

export const TRANSCRIPT_BUDGET_BYTES = 32 * 1024 * 1024
export const TRANSCRIPT_RETIRE_IDLE_MS = 7 * 24 * 60 * 60 * 1000
export const TRANSCRIPT_EVICT_IDLE_MS = 24 * 60 * 60 * 1000
export const TRANSCRIPT_RETIRED_TTL_MS = 90 * 24 * 60 * 60 * 1000

const TRANSCRIPT = "transcript.jsonl"
const STATE = "state.json"
const LOCK = "state.lock"
const MAX_STATE_BYTES = 64 * 1024

export type TranscriptBudgetOptions = {
  readonly transcriptsDir: string
  readonly budgetBytes?: number
  readonly retireIdleMs?: number
  readonly evictIdleMs?: number
  readonly retiredTtlMs?: number
  readonly now?: () => number
  readonly isLive?: (sessionId: string) => boolean
  /**
   * Asked under the journal lock before a journal is retired or evicted; false keeps it. The facts lane
   * answers here: it clears the conversation's watermarks, or refuses while one of its batches is queued.
   */
  readonly releaseConversation?: (conversationId: string) => Promise<boolean>
  readonly lock?: JournalLock
  readonly signal?: AbortSignal
}

export type TranscriptBudgetKeepReason = "live" | "recent" | "facts-pending" | "locked"

export type TranscriptBudgetResult = {
  readonly bytesBefore: number
  readonly bytesAfter: number
  readonly budgetBytes: number
  readonly retired: readonly string[]
  readonly evicted: readonly string[]
  readonly expired: readonly string[]
  readonly kept: Readonly<Partial<Record<TranscriptBudgetKeepReason, number>>>
}

type JournalInfo = {
  readonly id: string
  readonly dir: string
  readonly bytes: number
  readonly transcriptBytes: number
  readonly activeAtMs: number
  readonly retiredMarker: boolean
  readonly live: boolean
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function describeJournal(id: string, dir: string, live: boolean): Promise<JournalInfo | undefined> {
  let bytes = 0
  let transcriptBytes = 0
  let transcriptMtime: number | undefined
  let otherMtime = 0
  let retiredMarker = false
  let names
  try {
    names = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return undefined
    throw error
  }
  for (const entry of names) {
    if (!entry.isFile()) continue
    const info = await lstat(join(dir, entry.name)).catch(() => undefined)
    if (info === undefined) continue
    bytes += info.size
    if (entry.name === TRANSCRIPT) {
      transcriptBytes = info.size
      transcriptMtime = info.mtimeMs
    } else {
      if (entry.name === RETIRED_IDS_FILE) retiredMarker = true
      otherMtime = Math.max(otherMtime, info.mtimeMs)
    }
  }
  // Appends are the only real activity: state.json is rewritten by status reads of an idle session.
  const activeAtMs = transcriptMtime ?? otherMtime
  return { id, dir, bytes, transcriptBytes, activeAtMs, retiredMarker, live }
}

/** Reflection has consumed every assistant step the journal recorded (from the small state file). */
async function reflectionCaughtUp(dir: string): Promise<boolean> {
  const path = join(dir, STATE)
  const info = await lstat(path).catch(() => undefined)
  if (info === undefined || info.size > MAX_STATE_BYTES) return false
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (parsed === null || typeof parsed !== "object") return false
    const pending = Reflect.get(parsed, "steps_since_last_successful_reflection")
    const reflected = Reflect.get(parsed, "reflected_through_message_id")
    return pending === 0 && typeof reflected === "string" && reflected.length > 0
  } catch {
    return false
  }
}

async function expireRetired(dir: string, lock: JournalLock): Promise<"removed" | "locked" | "changed"> {
  try {
    const verdict = await lock(join(dir, LOCK), async () => {
      const transcript = await lstat(join(dir, TRANSCRIPT)).catch(() => undefined)
      if (transcript !== undefined && transcript.size > 0) return "changed" as const
      for (const name of [RETIRED_IDS_FILE, STATE, TRANSCRIPT]) {
        await unlink(join(dir, name)).catch((error: unknown) => {
          if (errorCode(error) !== "ENOENT") throw error
        })
      }
      return "removed" as const
    })
    if (verdict !== "removed") return verdict
  } catch (error) {
    if (error instanceof JournalLockTimeoutError) return "locked"
    throw error
  }
  try {
    await rmdir(dir)
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOTEMPTY" || code === "EEXIST") return "changed"
    if (code !== "ENOENT") throw error
  }
  return "removed"
}

export async function enforceTranscriptBudget(options: TranscriptBudgetOptions): Promise<TranscriptBudgetResult> {
  const budgetBytes = options.budgetBytes ?? TRANSCRIPT_BUDGET_BYTES
  const now = (options.now ?? Date.now)()
  const lock = options.lock ?? withLocalJournalLock
  const retired: string[] = []
  const evicted: string[] = []
  const expired: string[] = []
  const kept: Partial<Record<TranscriptBudgetKeepReason, number>> = {}
  const keep = (reason: TranscriptBudgetKeepReason): void => {
    kept[reason] = (kept[reason] ?? 0) + 1
  }

  let entries
  try {
    entries = await readdir(options.transcriptsDir, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") {
      return { bytesBefore: 0, bytesAfter: 0, budgetBytes, retired, evicted, expired, kept }
    }
    throw error
  }
  const journals: JournalInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    options.signal?.throwIfAborted()
    const info = await describeJournal(entry.name, join(options.transcriptsDir, entry.name), options.isLive?.(entry.name) === true)
    if (info !== undefined) journals.push(info)
  }
  const bytesBefore = journals.reduce((total, journal) => total + journal.bytes, 0)
  let bytes = bytesBefore

  async function retire(journal: JournalInfo): Promise<boolean> {
    const release = options.releaseConversation
    const result = await retireTranscriptJournal(journal.dir, {
      lock,
      ...(release === undefined ? {} : { beforeRetire: () => release(journal.id) }),
    })
    if (result.status === "refused") {
      keep("facts-pending")
      return false
    }
    if (result.status === "locked") {
      keep("locked")
      return false
    }
    const after = await describeJournal(journal.id, journal.dir, journal.live)
    bytes += (after?.bytes ?? 0) - journal.bytes
    return true
  }

  const remaining: JournalInfo[] = []
  for (const journal of journals) {
    options.signal?.throwIfAborted()
    if (journal.transcriptBytes === 0) continue
    if (journal.live) {
      keep("live")
      continue
    }
    if (now - journal.activeAtMs >= (options.retireIdleMs ?? TRANSCRIPT_RETIRE_IDLE_MS) && (await reflectionCaughtUp(journal.dir))) {
      if (await retire(journal)) retired.push(journal.id)
      continue
    }
    remaining.push(journal)
  }

  if (bytes > budgetBytes) {
    const evictIdleMs = options.evictIdleMs ?? TRANSCRIPT_EVICT_IDLE_MS
    const oldestFirst = remaining
      .filter((journal) => now - journal.activeAtMs >= evictIdleMs)
      .sort((left, right) => left.activeAtMs - right.activeAtMs)
    for (const journal of oldestFirst) {
      if (bytes <= budgetBytes) break
      options.signal?.throwIfAborted()
      if (await retire(journal)) evicted.push(journal.id)
    }
    if (bytes > budgetBytes) keep("recent")
  }

  const retiredTtlMs = options.retiredTtlMs ?? TRANSCRIPT_RETIRED_TTL_MS
  for (const journal of journals) {
    if (!journal.retiredMarker || journal.transcriptBytes > 0 || journal.live) continue
    if (now - journal.activeAtMs < retiredTtlMs) continue
    options.signal?.throwIfAborted()
    const outcome = await expireRetired(journal.dir, lock)
    if (outcome === "removed") {
      expired.push(journal.id)
      bytes -= journal.bytes
    } else if (outcome === "locked") {
      keep("locked")
    }
  }

  return { bytesBefore, bytesAfter: Math.max(0, bytes), budgetBytes, retired, evicted, expired, kept }
}
