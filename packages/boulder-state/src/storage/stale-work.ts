import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import type {
  BoulderState,
  BoulderWorkState,
  ReconcileStaleWorksOptions,
  StaleWorkDemotion,
  StaleWorkReconcileResult,
} from "../types"
import { getBoulderWorks, readBoulderState } from "./read-state"
import { parseIsoToMs, projectWorkToMirror, stripSessionPlatform } from "./shared"
import { writeBoulderState } from "./write-state"

/** A ulw-execute session that dies abnormally never completes its work, so activity decides. */
export const DEFAULT_STALE_WORK_THRESHOLD_MS = 6 * 60 * 60 * 1000
export const STALE_WORK_THRESHOLD_ENV_KEY = "OMO_BOULDER_STALE_WORK_THRESHOLD_MS"

const SESSION_TRANSCRIPT_SUFFIX = ".jsonl"
const NO_CHANGES: StaleWorkReconcileResult = { demoted: [], written: false }

type Env = Readonly<Record<string, string | undefined>>

export function resolveStaleWorkThresholdMs(env: Env = process.env): number {
  const raw = env[STALE_WORK_THRESHOLD_ENV_KEY]?.trim()
  if (!raw) {
    return DEFAULT_STALE_WORK_THRESHOLD_MS
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STALE_WORK_THRESHOLD_MS
  }

  return parsed
}

/**
 * Pure staleness rule: a work with no activity evidence at all is stale, and recorded activity
 * older than the threshold is stale. A stamp in the future (clock skew) counts as activity.
 */
export function isWorkStale(input: { lastActivityMs: number | null; nowMs: number; thresholdMs: number }): boolean {
  if (input.lastActivityMs === null) {
    return true
  }

  return input.nowMs - input.lastActivityMs >= input.thresholdMs
}

/**
 * Demotes every `active` work whose last activity is older than the threshold to `paused` and
 * stamps `stale_since`. Nothing stale means no write at all; `completed`/`abandoned` works and
 * works with no recorded status are never touched, and a failure of any kind is swallowed so a
 * read path can call this unconditionally.
 */
export function reconcileStaleWorks(
  directory: string,
  options: ReconcileStaleWorksOptions = {},
): StaleWorkReconcileResult {
  try {
    const state = readBoulderState(directory)
    if (!state) {
      return NO_CHANGES
    }

    const nowMs = options.now ?? Date.now()
    const thresholdMs = options.thresholdMs ?? resolveStaleWorkThresholdMs(options.env)
    const works = getBoulderWorks(state)
    const staleSince = new Date(nowMs).toISOString()
    const demoted: StaleWorkDemotion[] = []
    const demotedWorks = new Map<string, BoulderWorkState>()

    for (const work of works) {
      if (work.status !== "active") {
        continue
      }

      const lastActivityMs = resolveLastActivityMs({
        work,
        directory,
        nowMs,
        thresholdMs,
        ...(options.sessionsDirectory !== undefined ? { sessionsDirectory: options.sessionsDirectory } : {}),
      })
      if (!isWorkStale({ lastActivityMs, nowMs, thresholdMs })) {
        continue
      }

      demotedWorks.set(work.work_id, { ...work, status: "paused", stale_since: staleSince })
      demoted.push({
        work_id: work.work_id,
        stale_since: staleSince,
        last_activity_at: lastActivityMs === null ? null : new Date(lastActivityMs).toISOString(),
      })
    }

    if (demoted.length === 0) {
      return NO_CHANGES
    }

    const nextWorks = Object.fromEntries(
      works.map((work) => [work.work_id, demotedWorks.get(work.work_id) ?? work]),
    )
    // A legacy mirror-only state carries its single work implicitly; persisting a demotion
    // materializes it exactly like selectActiveWork/addBoulderWork already do.
    const activeWorkId = state.active_work_id ?? (works.length === 1 ? works[0]?.work_id : undefined)
    const nextState: BoulderState = {
      ...state,
      schema_version: 2,
      works: nextWorks,
      ...(activeWorkId !== undefined ? { active_work_id: activeWorkId } : {}),
    }

    const mirrorWork = activeWorkId === undefined ? undefined : nextWorks[activeWorkId]
    if (mirrorWork) {
      projectWorkToMirror(nextState, mirrorWork)
    }

    return writeBoulderState(directory, nextState) ? { demoted, written: true } : NO_CHANGES
  } catch {
    return NO_CHANGES
  }
}

function resolveLastActivityMs(input: {
  work: BoulderWorkState
  directory: string
  nowMs: number
  thresholdMs: number
  sessionsDirectory?: string
}): number | null {
  const recordedMs = newestMs([parseIsoToMs(input.work.updated_at), parseIsoToMs(input.work.started_at)])
  // Recorded activity inside the window already proves the work is not stale, so the transcript
  // scan only runs for works that would otherwise be demoted.
  if (recordedMs !== null && input.nowMs - recordedMs < input.thresholdMs) {
    return recordedMs
  }

  if (input.sessionsDirectory === undefined) {
    return recordedMs
  }

  return newestMs([
    recordedMs,
    findNewestSessionTranscriptMs({
      sessionsDirectory: input.sessionsDirectory,
      sessionIds: input.work.session_ids,
      sessionCwds: [input.directory, input.work.worktree_path],
    }),
  ])
}

/**
 * Newest mtime of the transcripts belonging to `sessionIds` under an agent sessions directory,
 * which stores them as `<encoded session cwd>/<timestamp>_<sessionId>.jsonl` (and, on older
 * layouts, flat at the root). Only session directories that look like one of `sessionCwds` are
 * read: an agent home accumulates thousands of them and reading them all costs seconds.
 */
export function findNewestSessionTranscriptMs(input: {
  sessionsDirectory: string
  sessionIds: readonly string[]
  sessionCwds: readonly (string | undefined)[]
}): number | null {
  const sessionIds = input.sessionIds
    .map((sessionId) => stripSessionPlatform(sessionId))
    .filter((sessionId) => sessionId.length > 0)
  const needles = input.sessionCwds
    .filter((cwd): cwd is string => typeof cwd === "string" && cwd.trim().length > 0)
    .map((cwd) => normalizePathForMatch(cwd))
  if (sessionIds.length === 0) {
    return null
  }

  let entries: { name: string; isDirectory: boolean; isFile: boolean }[]
  try {
    entries = readdirSync(input.sessionsDirectory, { withFileTypes: true })
      .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile() }))
  } catch {
    return null
  }

  let newest: number | null = null
  for (const entry of entries) {
    if (entry.isFile) {
      if (isTranscriptOf(entry.name, sessionIds)) {
        newest = newestMs([newest, mtimeMs(join(input.sessionsDirectory, entry.name))])
      }
      continue
    }

    if (!entry.isDirectory || !matchesSessionCwd(entry.name, needles)) {
      continue
    }

    const sessionDirectory = join(input.sessionsDirectory, entry.name)
    let fileNames: string[]
    try {
      fileNames = readdirSync(sessionDirectory)
    } catch {
      continue
    }

    for (const fileName of fileNames) {
      if (isTranscriptOf(fileName, sessionIds)) {
        newest = newestMs([newest, mtimeMs(join(sessionDirectory, fileName))])
      }
    }
  }

  return newest
}

function isTranscriptOf(fileName: string, sessionIds: readonly string[]): boolean {
  if (!fileName.endsWith(SESSION_TRANSCRIPT_SUFFIX)) {
    return false
  }

  return sessionIds.some(
    (sessionId) =>
      fileName === `${sessionId}${SESSION_TRANSCRIPT_SUFFIX}`
      || fileName.endsWith(`_${sessionId}${SESSION_TRANSCRIPT_SUFFIX}`),
  )
}

/**
 * The encoding of a session cwd into a directory name belongs to the agent, so the two are
 * compared on their alphanumeric shape and in both directions: a session cwd and the path the
 * agent recorded can differ by a resolved symlink prefix such as /var vs /private/var.
 */
function matchesSessionCwd(directoryName: string, needles: readonly string[]): boolean {
  const normalized = normalizePathForMatch(directoryName)
  return needles.some((needle) => normalized.includes(needle) || needle.includes(normalized))
}

function normalizePathForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

function mtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

function newestMs(values: readonly (number | null)[]): number | null {
  let newest: number | null = null
  for (const value of values) {
    if (value === null || Number.isNaN(value)) {
      continue
    }

    if (newest === null || value > newest) {
      newest = value
    }
  }

  return newest
}
