import {
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
import { appendTaskEvent, closeAppendFd, type AppendFdCache } from "./event-log"
import { withTaskRecordLock } from "./record-lock"
import { parseTaskRecord } from "./record-parse"
import { writeRecord } from "./record-write"
import { resolveStateDir } from "./state-dir"
import type {
  ListTaskRecordsResult,
  PersistedTaskEvent,
  StateDirConfig,
  TaskRecordDiagnostic,
  TaskRecordStore,
} from "./types"

export { TaskRecordCollisionError } from "./record-write"

export type TaskRecordStoreOptions = {
  // Test seam: the rename-retry branch is win32-only, so tests inject the platform instead of
  // running only on Windows CI. Production omits this and reads process.platform.
  readonly platform?: NodeJS.Platform
}

type CacheEntry = {
  readonly record: TaskRecord
  readonly mtimeMs: number
  readonly size: number
  readonly warnings: readonly string[]
}

export function createTaskRecordStore(config: StateDirConfig, options: TaskRecordStoreOptions = {}): TaskRecordStore {
  const stateDir = resolveStateDir(config)
  const platform = options.platform ?? process.platform
  const cache = new Map<string, CacheEntry>()
  const appendFds: AppendFdCache = new Map()

  function cacheSet(path: string): void {
    const warnings: string[] = []
    const record = readRecord(path, warnings)
    if (record === null) return
    const stat = statSync(path)
    cache.set(path, { record, mtimeMs: stat.mtimeMs, size: stat.size, warnings })
  }

  return {
    stateDir,
    save(record) {
      const path = taskPath(stateDir, parseTaskId(record.task_id))
      writeRecord(path, record, "create", platform)
      cacheSet(path)
    },
    replace(record) {
      const taskId = parseTaskId(record.task_id)
      const path = taskPath(stateDir, taskId)
      withTaskRecordLock(path, () => {
        writeRecord(path, record, "replace", platform)
        cacheSet(path)
      })
    },
    mutate(taskId, mutation) {
      const parsedTaskId = parseTaskId(taskId)
      const path = taskPath(stateDir, parsedTaskId)
      return withTaskRecordLock(path, () => {
        const current = readRecord(path)
        if (current === null) return null
        const next = mutation(current)
        if (next !== current) writeRecord(path, next, "replace", platform)
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
        appendTaskEvent(stateDir, parsedTaskId, { type: result.audit.type, payload: result.audit }, appendFds)
        if (result.applied) writeRecord(path, result.record, "replace", platform)
        cacheSet(path)
        return result
      })
    },
    remove(taskId) {
      const parsedTaskId = parseTaskId(taskId)
      const path = taskPath(stateDir, parsedTaskId)
      withTaskRecordLock(path, () => removeRecord(stateDir, parsedTaskId, cache, appendFds))
    },
    tombstoneIfExpired(taskId, shouldRetain) {
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
        renameSync(path, tombstonePath(stateDir, parsedTaskId))
        cache.delete(path)
        return { kind: "tombstoned", record: current } as const
      })
    },
    completeExpunge(taskId) {
      const parsedTaskId = parseTaskId(taskId)
      // Phase 2 (and crash recovery): the record is already tombstoned - committed to deletion,
      // invisible to load/list, never resurrected - so this is idempotent and needs no lock.
      removeRecord(stateDir, parsedTaskId, cache, appendFds)
      rmSync(tombstonePath(stateDir, parsedTaskId), { force: true })
    },
    listExpunging() {
      const tasksDir = join(stateDir, "tasks")
      mkdirSync(tasksDir, { recursive: true })
      return readdirSync(tasksDir)
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
  const logPath = join(stateDir, "logs", `${taskId}.jsonl`)
  rmSync(logPath, { force: true })
  closeAppendFd(logPath, appendFds)
  // (4) record LAST
  const recordPath = taskPath(stateDir, taskId)
  rmSync(recordPath, { force: true })
  cache.delete(recordPath)
}

function listRecords(stateDir: string, cache: Map<string, CacheEntry>): ListTaskRecordsResult {
  const tasksDir = join(stateDir, "tasks")
  mkdirSync(tasksDir, { recursive: true })
  const records: TaskRecord[] = []
  const diagnostics: TaskRecordDiagnostic[] = []
  const seen = new Set<string>()

  for (const file of readdirSync(tasksDir).filter((entry) => entry.endsWith(".json")).toSorted()) {
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

function readCached(path: string, cache: Map<string, CacheEntry>): TaskRecord | null {
  let stat: Stats
  try {
    stat = statSync(path)
  } catch (error) {
    if (isEnoent(error)) {
      cache.delete(path)
      return null
    }
    throw error
  }

  const hit = cache.get(path)
  if (hit !== undefined && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    return hit.record
  }

  const warnings: string[] = []
  const record = readRecord(path, warnings)
  if (record !== null) cache.set(path, { record, mtimeMs: stat.mtimeMs, size: stat.size, warnings })
  return record
}

function readRecord(path: string, warnings: string[] = []): TaskRecord | null {
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
