import { join } from "node:path"

import { lstat, open, readdir, rmdir, unlink } from "../fs/resilient"
import { JournalLockTimeoutError, withLocalJournalLock, type JournalLock } from "./lock"

export type EmptyJournalKeepReason =
  | "live"
  | "locked"
  | "recent"
  | "transcript-content"
  | "state-content"
  | "state-unreadable"
  | "other-content"
  | "changed-during-removal"

export type EmptyJournalSweepResult = {
  readonly removed: readonly string[]
  readonly kept: Readonly<Partial<Record<EmptyJournalKeepReason, number>>>
}

export type EmptyJournalSweepOptions = {
  readonly transcriptsDir: string
  readonly minIdleMs?: number
  readonly now?: () => number
  readonly isLive?: (sessionId: string) => boolean
  readonly lock?: JournalLock
}

const DEFAULT_MIN_IDLE_MS = 10 * 60 * 1000
const TRANSCRIPT = "transcript.jsonl"
const STATE = "state.json"
const LOCK = "state.lock"
// A transcript or state file larger than this has content; only smaller ones are read, so the sweep
// stays a directory walk even over identities with thousands of long journals.
const MAX_INSPECTED_BYTES = 4096

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function readSmall(path: string): Promise<string> {
  const handle = await open(path, "r")
  try {
    const buffer = Buffer.alloc(MAX_INSPECTED_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, MAX_INSPECTED_BYTES, 0)
    return buffer.subarray(0, bytesRead).toString("utf8")
  } finally {
    await handle.close()
  }
}

function stateIsEmpty(raw: string): boolean | "unreadable" {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return "unreadable"
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "unreadable"
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "schema_version") continue
    if (value === undefined || value === null || value === 0 || value === false) continue
    return false
  }
  return true
}

type Inspection = EmptyJournalKeepReason | { readonly files: readonly string[] }

/**
 * `holdingLock` is the re-check made under the journal lock: the lock file is then this sweep's own
 * and the directory mtime moved when it was created, so only the files are judged.
 */
async function inspect(journalDir: string, cutoffMs: number, holdingLock: boolean): Promise<Inspection> {
  if (!holdingLock && (await lstat(journalDir)).mtimeMs > cutoffMs) return "recent"
  const files: string[] = []
  let transcript: string | undefined
  for (const entry of await readdir(journalDir, { withFileTypes: true })) {
    if (entry.name === LOCK) {
      if (holdingLock) continue
      return "locked"
    }
    const path = join(journalDir, entry.name)
    if (!entry.isFile()) return "other-content"
    const info = await lstat(path)
    if (info.mtimeMs > cutoffMs) return "recent"
    if (entry.name === TRANSCRIPT) {
      if (info.size > MAX_INSPECTED_BYTES || (await readSmall(path)).trim().length > 0) return "transcript-content"
      transcript = path
      continue
    }
    if (entry.name === STATE) {
      if (info.size > MAX_INSPECTED_BYTES) return "state-content"
      const verdict = info.size === 0 ? true : stateIsEmpty(await readSmall(path))
      if (verdict === "unreadable") return "state-unreadable"
      if (!verdict) return "state-content"
    } else if (info.size > 0) {
      return "other-content"
    }
    files.push(path)
  }
  // The transcript goes last: an interrupted sweep leaves it behind, so the next pass finds the
  // directory still sweepable.
  return { files: transcript === undefined ? files : [...files, transcript] }
}

async function removeUnderLock(
  journalDir: string,
  cutoffMs: number,
  lock: JournalLock,
): Promise<EmptyJournalKeepReason | "removed"> {
  let verdict: Inspection
  try {
    verdict = await lock(join(journalDir, LOCK), async () => {
      const current = await inspect(journalDir, cutoffMs, true)
      if (typeof current === "string") return current
      for (const file of current.files) {
        await unlink(file).catch((error: unknown) => {
          if (errorCode(error) !== "ENOENT") throw error
        })
      }
      return current
    })
  } catch (error) {
    if (error instanceof JournalLockTimeoutError) return "locked"
    throw error
  }
  if (typeof verdict === "string") return verdict
  try {
    await rmdir(journalDir)
    return "removed"
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOTEMPTY" || code === "EEXIST") return "changed-during-removal"
    if (code === "ENOENT") return "removed"
    throw error
  }
}

/**
 * Deletes journals that never recorded anything (#9737). A journal is removed only when ALL hold:
 * empty or absent transcript, state without entries or reflection progress, no other file with
 * content, no lock held by anyone else, session not live, nothing modified within `minIdleMs`.
 * The files are re-checked and deleted while holding the journal lock, the transcript last, and the
 * directory is removed without recursion after the lock is released, so a writer racing the sweep
 * either waits for it and starts a fresh journal or makes the sweep keep the directory.
 */
export async function sweepEmptyTranscriptJournals(
  options: EmptyJournalSweepOptions,
): Promise<EmptyJournalSweepResult> {
  const cutoffMs = (options.now ?? Date.now)() - (options.minIdleMs ?? DEFAULT_MIN_IDLE_MS)
  const lock = options.lock ?? withLocalJournalLock
  const removed: string[] = []
  const kept: Partial<Record<EmptyJournalKeepReason, number>> = {}
  const keep = (reason: EmptyJournalKeepReason): void => {
    kept[reason] = (kept[reason] ?? 0) + 1
  }
  let entries
  try {
    entries = await readdir(options.transcriptsDir, { withFileTypes: true })
  } catch (error) {
    // No transcripts directory, or a path segment above it is a file: there are no journals.
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return { removed, kept }
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (options.isLive?.(entry.name) === true) {
      keep("live")
      continue
    }
    const journalDir = join(options.transcriptsDir, entry.name)
    try {
      const first = await inspect(journalDir, cutoffMs, false)
      if (typeof first === "string") {
        keep(first)
        continue
      }
      const outcome = await removeUnderLock(journalDir, cutoffMs, lock)
      if (outcome === "removed") removed.push(entry.name)
      else keep(outcome)
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue
      throw error
    }
  }
  return { removed, kept }
}
