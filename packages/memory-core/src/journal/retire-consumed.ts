// Consumed-journal retirement pass over one identity's <runtime>/transcripts.
//
// A journal is retired only when ALL hold: reflection has consumed every assistant step it recorded,
// nothing was appended for `retireIdleMs` (default 7 days), and the session is not live. Retirement
// itself (retire.ts) runs under the journal lock and asks `releaseConversation` first, so the facts lane
// can refuse while one of its batches for the conversation is still queued. Unconsumed journals are never
// touched here. Nothing reads a transcript into memory: decisions come from file sizes, mtimes and the
// small state.json, and retirement streams.

import { join } from "node:path"

import { lstat, readFile, readdir } from "../fs/resilient"
import { withLocalJournalLock, type JournalLock } from "./lock"
import { retireTranscriptJournal } from "./retire"

export const TRANSCRIPT_RETIRE_IDLE_MS = 7 * 24 * 60 * 60 * 1000

const TRANSCRIPT = "transcript.jsonl"
const STATE = "state.json"
const MAX_STATE_BYTES = 64 * 1024

export type ConsumedJournalRetirementOptions = {
  readonly transcriptsDir: string
  readonly retireIdleMs?: number
  readonly now?: () => number
  readonly isLive?: (sessionId: string) => boolean
  /**
   * Asked under the journal lock before a journal is retired; false keeps it. The facts lane answers
   * here: it clears the conversation's watermarks, or refuses while one of its batches is queued.
   */
  readonly releaseConversation?: (conversationId: string) => Promise<boolean>
  readonly lock?: JournalLock
  readonly signal?: AbortSignal
}

export type ConsumedJournalKeepReason = "live" | "recent" | "unconsumed" | "facts-pending" | "locked"

export type ConsumedJournalRetirementResult = {
  readonly retired: readonly string[]
  readonly freedBytes: number
  readonly kept: Readonly<Partial<Record<ConsumedJournalKeepReason, number>>>
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
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

export async function retireConsumedTranscriptJournals(
  options: ConsumedJournalRetirementOptions,
): Promise<ConsumedJournalRetirementResult> {
  const now = (options.now ?? Date.now)()
  const idleMs = options.retireIdleMs ?? TRANSCRIPT_RETIRE_IDLE_MS
  const lock = options.lock ?? withLocalJournalLock
  const retired: string[] = []
  const kept: Partial<Record<ConsumedJournalKeepReason, number>> = {}
  const keep = (reason: ConsumedJournalKeepReason): void => {
    kept[reason] = (kept[reason] ?? 0) + 1
  }
  let freedBytes = 0

  let entries
  try {
    entries = await readdir(options.transcriptsDir, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return { retired, freedBytes, kept }
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    options.signal?.throwIfAborted()
    const dir = join(options.transcriptsDir, entry.name)
    // Appends are the only real activity: state.json is rewritten by status reads of an idle session.
    const transcript = await lstat(join(dir, TRANSCRIPT)).catch(() => undefined)
    if (transcript === undefined || transcript.size === 0) continue
    if (options.isLive?.(entry.name) === true) {
      keep("live")
      continue
    }
    if (now - transcript.mtimeMs < idleMs) {
      keep("recent")
      continue
    }
    if (!(await reflectionCaughtUp(dir))) {
      keep("unconsumed")
      continue
    }
    const release = options.releaseConversation
    const result = await retireTranscriptJournal(dir, {
      lock,
      ...(release === undefined ? {} : { beforeRetire: () => release(entry.name) }),
    })
    if (result.status === "retired") {
      retired.push(entry.name)
      freedBytes += result.freedBytes
    } else if (result.status === "refused") {
      keep("facts-pending")
    } else if (result.status === "locked") {
      keep("locked")
    }
  }
  return { retired, freedBytes, kept }
}
