import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  type Stats,
} from "node:fs"
import { join } from "node:path"

import { parseTaskId, transitionTaskRecord } from "../state"
import type { TaskId, TaskRecord } from "../state"
import { appendTaskEvent, closeAppendFd, taskEventLogPath, type AppendFdCache } from "./event-log"
import { holdsTombstone, removeExpungeOwner, readExpungeOwnerFile, restoreTombstone, takeOverTombstone, writeExpungeOwner } from "./expunge-owner"
import { withTaskRecordLock } from "./record-lock"
import { parseTaskRecord } from "./record-parse"
import { atomicReplace, TaskRecordCollisionError, writeRecord, type RecordWriteDeps } from "./record-write"
import { resolveStateDir } from "./state-dir"
import { toStorableTaskRecord } from "./storable-record"
import type {
  ListTaskRecordsResult,
  PersistedTaskEvent,
  StateDirConfig,
  TaskRecordDiagnostic,
  TaskRecordStore,
} from "./types"

export { TaskRecordCollisionError } from "./record-write"

export type TaskRecordStoreOptions = RecordWriteDeps & {
  // Test seam: the rename-retry branch is win32-only, so tests inject the platform instead of
  // running only on Windows CI. Production omits this and reads process.platform.
  readonly platform?: NodeJS.Platform
}

type CacheEntry = {
  readonly selectedPath: string
  readonly record: TaskRecord
  readonly mtimeMs: number
  readonly size: number
  readonly warnings: readonly string[]
}

/** What the store keeps resident, read by the on-demand memory report (oh-my-openagent#9442). */
export type TaskRecordStoreResidentFigures = {
  readonly cachedRecords: number
  /** On-disk size of the cached records' files. */
  readonly cachedRecordBytes: number
  readonly openEventLogs: number
}

export type ResidentTaskRecordStore = TaskRecordStore & {
  residentFigures(): TaskRecordStoreResidentFigures
}

export function createTaskRecordStore(config: StateDirConfig, options: TaskRecordStoreOptions = {}): ResidentTaskRecordStore {
  const stateDir = resolveStateDir(config)
  const platform = options.platform ?? process.platform
  const cache = new Map<string, CacheEntry>()
  const appendFds: AppendFdCache = new Map()

  function cacheSet(path: string): void {
    const warnings: string[] = []
    const selectedPath = recordWritePath(path)
    const record = readSelectedRecord(selectedPath, warnings)
    if (record === null) return
    const stat = statSync(selectedPath)
    cache.set(path, { selectedPath, record, mtimeMs: stat.mtimeMs, size: stat.size, warnings })
  }

  return {
    stateDir,
    residentFigures() {
      let cachedRecordBytes = 0
      for (const entry of cache.values()) cachedRecordBytes += entry.size
      return { cachedRecords: cache.size, cachedRecordBytes, openEventLogs: appendFds.size }
    },
    save(record) {
      const path = taskPath(stateDir, parseTaskId(record.task_id))
      if (existsSync(spawnFailurePath(path))) throw new TaskRecordCollisionError({ taskId: parseTaskId(record.task_id), path })
      writeRecord(path, record, "create", platform, options)
      cacheSet(path)
    },
    replace(record) {
      const taskId = parseTaskId(record.task_id)
      const path = taskPath(stateDir, taskId)
      withTaskRecordLock(path, () => {
        writeRecord(recordWritePath(path), record, "replace", platform, options)
        cacheSet(path)
      })
    },
    markSpawnFailed(record, errorMessage = "spawn bookkeeping failed") {
      const path = taskPath(stateDir, parseTaskId(record.task_id))
      return withTaskRecordLock(path, () => {
        const fresh = readRecord(path)
        if (fresh === null) return null
        if (fresh.host_pid !== record.host_pid || fresh.notification.run_epoch !== record.notification.run_epoch) return fresh
        if (fresh.status !== "pending" && fresh.status !== "running") return fresh
        if (fresh.child_session_id !== undefined || fresh.host_session !== undefined || fresh.pid !== undefined) return fresh
        const timestamp = new Date().toISOString()
        const failed: TaskRecord = {
          ...fresh, status: "error", residency_state: "disposed", error_message: errorMessage,
          terminal_at: timestamp, updated_at: timestamp,
        }
        // The held target is never replaced or unlinked. Publish the complete terminal record at
        // a separate path through the SAME atomic writer, so readers never see a partial marker.
        atomicReplace(spawnFailurePath(path), JSON.stringify(toStorableTaskRecord(failed)), platform, options)
        cache.delete(path)
        return failed
      })
    },
    mutate(taskId, mutation) {
      const parsedTaskId = parseTaskId(taskId)
      const path = taskPath(stateDir, parsedTaskId)
      return withTaskRecordLock(path, () => {
        const current = readRecord(path)
        if (current === null) return null
        const next = mutation(current)
        if (next !== current) writeRecord(recordWritePath(path), next, "replace", platform, options)
        cacheSet(path)
        return next
      })
    },
    load(taskId) {
      return readCached(taskPath(stateDir, parseTaskId(taskId)), cache)
    },
    list() {
      return listRecords(stateDir, cache)
    },
    appendEvent(taskId, event) {
      return appendTaskEvent(stateDir, parseTaskId(taskId), event, appendFds)
    },
    transition(taskId, transition) {
      const parsedTaskId = parseTaskId(taskId)
      const path = taskPath(stateDir, parsedTaskId)
      return withTaskRecordLock(path, () => {
        const record = readRecord(path)
        if (record === null) throw new Error(`Task record not found: ${taskId}`)
        const result = transitionTaskRecord(record, transition)
        if (result.applied) writeRecord(recordWritePath(path), result.record, "replace", platform, options)
        appendTaskEvent(stateDir, parsedTaskId, { type: result.audit.type, payload: result.audit }, appendFds)
        cacheSet(path)
        return result
      })
    },
    remove(taskId) {
      const parsedTaskId = parseTaskId(taskId)
      const path = taskPath(stateDir, parsedTaskId)
      withTaskRecordLock(path, () => removeRecord(stateDir, parsedTaskId, cache, appendFds))
    },
    tombstoneIfExpired(taskId, shouldRetain, owner) {
      const parsedTaskId = parseTaskId(taskId)
      const path = taskPath(stateDir, parsedTaskId)
      // The lock file lives beside the record, so the tasks dir must exist even when the record
      // itself was never written (the "missing" outcome is defined and must not throw ENOENT).
      mkdirSync(join(stateDir, "tasks"), { recursive: true })
      return withTaskRecordLock(path, () => {
        // Re-read + validate + tombstone ONLY: artifact deletion is phase 2, outside the lock,
        // because recursive filesystem work can outlive any lease.
        const current = readRecord(path)
        if (current === null) return { kind: "missing" } as const
        if (shouldRetain(current)) return { kind: "retained" } as const
        if (owner !== undefined) writeExpungeOwner(tombstonePath(stateDir, parsedTaskId), owner)
        renameSync(path, tombstonePath(stateDir, parsedTaskId))
        cache.delete(path)
        return { kind: "tombstoned", record: current } as const
      })
    },
    completeExpunge(taskId, owner) {
      const parsedTaskId = parseTaskId(taskId)
      const tombstone = tombstonePath(stateDir, parsedTaskId)
      // Phase 2 (and crash recovery): the tombstone is committed to deletion and invisible to load/list.
      // An owned attempt first confirms, under the record lock, that the tombstone is still its own.
      if (owner !== undefined && !holdsTombstone(taskPath(stateDir, parsedTaskId), tombstone, owner)) return false
      removeRecord(stateDir, parsedTaskId, cache, appendFds)
      rmSync(tombstone, { force: true })
      removeExpungeOwner(tombstone)
      return true
    },
    loadExpunging(taskId) {
      return readRecord(tombstonePath(stateDir, parseTaskId(taskId)))
    },
    restoreExpunging(taskId, owner) {
      const parsedTaskId = parseTaskId(taskId)
      const path = taskPath(stateDir, parsedTaskId)
      if (restoreTombstone(path, tombstonePath(stateDir, parsedTaskId), owner)) cache.delete(path)
    },
    readExpungeOwner(taskId) {
      return readExpungeOwnerFile(tombstonePath(stateDir, parseTaskId(taskId)))
    },
    takeOverExpunging(taskId, from, to) {
      const parsedTaskId = parseTaskId(taskId)
      return takeOverTombstone(taskPath(stateDir, parsedTaskId), tombstonePath(stateDir, parsedTaskId), from, to)
    },
    listExpunging() {
      const tasksDir = join(stateDir, "tasks")
      return readDirectoryNames(tasksDir)
        .filter((entry) => entry.endsWith(TOMBSTONE_SUFFIX))
        .map((entry) => entry.slice(0, entry.length - TOMBSTONE_SUFFIX.length))
        .filter(isParseableTaskId)
        .toSorted()
    },
  }
}

function removeRecord(
  stateDir: string,
  taskId: TaskId,
  cache: Map<string, CacheEntry>,
  appendFds: AppendFdCache,
): void {
  // Record-last ordering: a crash mid-cleanup never orphans a record pointing at nothing.
  // (1) children/<taskId>/ recursively (session transcripts)
  rmSync(join(stateDir, "children", String(taskId)), { recursive: true, force: true })
  // (2) completion spill file
  rmSync(join(stateDir, "completion-results", `${taskId}.txt`), { force: true })
  // (3) task event log
  const logPath = taskEventLogPath(stateDir, String(taskId))
  rmSync(logPath, { force: true })
  closeAppendFd(logPath, appendFds)
  // (4) record LAST
  const recordPath = taskPath(stateDir, taskId)
  rmSync(recordPath, { force: true })
  rmSync(spawnFailurePath(recordPath), { force: true })
  cache.delete(recordPath)
}

function listRecords(stateDir: string, cache: Map<string, CacheEntry>): ListTaskRecordsResult {
  const tasksDir = join(stateDir, "tasks")
  const records: TaskRecord[] = []
  const diagnostics: TaskRecordDiagnostic[] = []
  const seen = new Set<string>()

  for (const file of readDirectoryNames(tasksDir).filter((entry) => entry.endsWith(".json")).toSorted()) {
    const path = join(tasksDir, file)
    seen.add(path)
    try {
      const record = readCached(path, cache)
      if (record !== null) {
        records.push(record)
        const cached = cache.get(path)
        if (cached !== undefined) {
          for (const warning of cached.warnings) {
            diagnostics.push({ type: "parse_warning", path, message: warning })
          }
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      diagnostics.push({ type: "parse_error", path, message: error.message })
    }
  }

  // Prune cached records that no longer exist on disk (e.g. TTL cleanup in another process).
  for (const key of cache.keys()) {
    if (!seen.has(key) && key.startsWith(tasksDir)) cache.delete(key)
  }

  return { records, diagnostics }
}

function readDirectoryNames(directory: string): string[] {
  try {
    return readdirSync(directory)
  } catch (error) {
    if (isEnoent(error)) return []
    throw error
  }
}

function readCached(path: string, cache: Map<string, CacheEntry>): TaskRecord | null {
  const selectedPath = recordWritePath(path)
  let stat: Stats
  try {
    stat = statSync(selectedPath)
  } catch (error) {
    if (isEnoent(error)) {
      cache.delete(path)
      return null
    }
    throw error
  }

  const hit = cache.get(path)
  if (hit !== undefined && hit.selectedPath === selectedPath && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    return hit.record
  }

  const warnings: string[] = []
  const record = readSelectedRecord(selectedPath, warnings)
  if (record !== null) cache.set(path, { selectedPath, record, mtimeMs: stat.mtimeMs, size: stat.size, warnings })
  return record
}

function readRecord(path: string, warnings: string[] = []): TaskRecord | null {
  return readSelectedRecord(recordWritePath(path), warnings)
}

function readSelectedRecord(path: string, warnings: string[] = []): TaskRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    return parseTaskRecord(parsed, path, warnings)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

const TOMBSTONE_SUFFIX = ".json.expunging"

function taskPath(stateDir: string, taskId: TaskId): string {
  return join(stateDir, "tasks", `${taskId}.json`)
}

function tombstonePath(stateDir: string, taskId: TaskId): string {
  return join(stateDir, "tasks", `${taskId}${TOMBSTONE_SUFFIX}`)
}

function isParseableTaskId(value: string): boolean {
  try {
    parseTaskId(value)
    return true
  } catch {
    return false
  }
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function spawnFailurePath(path: string): string {
  return `${path}.spawn-failed`
}

function recordWritePath(path: string): string {
  const original = path.endsWith(TOMBSTONE_SUFFIX) ? path.slice(0, -".expunging".length) : path
  const failed = spawnFailurePath(original)
  return existsSync(failed) ? failed : path
}
