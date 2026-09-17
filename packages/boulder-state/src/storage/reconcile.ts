import { statSync } from "node:fs"
import { join } from "node:path"

import type { BoulderState, BoulderWorkState } from "../types"
import { getBoulderWorks, readBoulderState } from "./read-state"
import { nowIsoString, parseIsoToMs, projectWorkToMirror } from "./shared"
import { writeBoulderState } from "./write-state"

/**
 * Default staleness threshold: a work whose newest session transcript is
 * older than this is considered dead and demoted from "active" to "paused".
 */
const DEFAULT_STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000 // 4 hours

export type ReconcileOptions = {
  /** Override the staleness threshold in milliseconds. */
  readonly staleThresholdMs?: number
  /** Override the current time (for testing). */
  readonly nowMs?: number
  /**
   * Resolve the transcript directory for a session ID.
   * Returns the directory that contains the session's transcript files,
   * or undefined if the session store is unavailable.
   */
  readonly resolveSessionDir?: (sessionId: string) => string | undefined
}

/**
 * Determine the last-activity timestamp for a work by checking:
 * 1. The newest mtime across its sessions' transcript files
 * 2. Its `updated_at` field
 * 3. Its `started_at` field
 *
 * Returns the newest of all available signals, or null if none are available.
 */
function lastActivityMs(
  work: BoulderWorkState,
  resolveSessionDir?: (sessionId: string) => string | undefined,
): number | null {
  let newest: number | null = null

  // Check session transcript mtimes
  if (resolveSessionDir) {
    for (const sessionId of work.session_ids) {
      const dir = resolveSessionDir(sessionId)
      if (!dir) continue
      try {
        const stats = statSync(dir)
        if (stats.mtimeMs > (newest ?? 0)) {
          newest = stats.mtimeMs
        }
      } catch {
        // Session directory missing or unreadable — skip
      }
    }
  }

  // Fall back to updated_at / started_at
  const updatedMs = parseIsoToMs(work.updated_at)
  if (updatedMs !== null && updatedMs > (newest ?? 0)) {
    newest = updatedMs
  }

  const startedMs = parseIsoToMs(work.started_at)
  if (startedMs !== null && startedMs > (newest ?? 0)) {
    newest = startedMs
  }

  return newest
}

/**
 * Reconcile stale boulder works: demote "active" works whose last activity
 * is older than the threshold to "paused", stamping when they went stale.
 *
 * Runs where the boulder file is already read (e.g. ulw-execute context
 * building), so the next session in a project fixes the record. Never
 * throws; never rewrites a healthy file.
 *
 * Returns the reconciled state, or null if no state exists or no changes
 * were needed.
 */
export function reconcileStaleBoulderWorks(
  directory: string,
  options?: ReconcileOptions,
): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) return null

  const thresholdMs = options?.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS
  const nowMs = options?.nowMs ?? Date.now()
  const works = getBoulderWorks(state)

  let changed = false
  const reconciledWorks: Record<string, BoulderWorkState> = {}

  for (const work of works) {
    if (work.status !== "active") {
      reconciledWorks[work.work_id] = work
      continue
    }

    const activityMs = lastActivityMs(work, options?.resolveSessionDir)
    if (activityMs === null || nowMs - activityMs <= thresholdMs) {
      reconciledWorks[work.work_id] = work
      continue
    }

    // Work is stale: demote to paused and stamp the time
    reconciledWorks[work.work_id] = {
      ...work,
      status: "paused",
      updated_at: nowIsoString(),
    }
    changed = true
  }

  if (!changed) return state

  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: reconciledWorks,
  }

  // Update mirror if the active work was demoted
  if (state.active_work_id) {
    const activeWork = reconciledWorks[state.active_work_id]
    if (activeWork) {
      projectWorkToMirror(nextState, activeWork)
    }
  }

  return writeBoulderState(directory, nextState) ? nextState : null
}

/**
 * Resume a paused work: set it back to "active" and update the timestamp.
 * Returns the updated state, or null if the work doesn't exist.
 */
export function resumeBoulderWork(
  directory: string,
  workId: string,
): BoulderState | null {
  const state = readBoulderState(directory)
  if (!state) return null

  const works = getBoulderWorks(state)
  const work = works.find((w) => w.work_id === workId)
  if (!work) return null

  const updatedWork: BoulderWorkState = {
    ...work,
    status: "active",
    updated_at: nowIsoString(),
  }

  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: {
      ...Object.fromEntries(works.map((w) => [w.work_id, w])),
      [workId]: updatedWork,
    },
  }

  if (state.active_work_id === workId) {
    projectWorkToMirror(nextState, updatedWork)
  }

  return writeBoulderState(directory, nextState) ? nextState : null
}
