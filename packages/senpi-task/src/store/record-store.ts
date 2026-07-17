import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  type Stats,
  writeFileSync,
  writeSync,
} from "node:fs"
import { join } from "node:path"

import { parseTaskId, transitionTaskRecord } from "../state"
import type { TaskId, TaskRecord } from "../state"
import { parseTaskRecord } from "./record-parse"
import { redactEventPayload } from "./redaction"
import { resolveStateDir } from "./state-dir"
import type {
  ListTaskRecordsResult,
  PersistedTaskEvent,
  StateDirConfig,
  TaskRecordDiagnostic,
  TaskRecordStore,
} from "./types"

type WriteRecordMode = "create" | "replace"

type CacheEntry = {
  readonly record: TaskRecord
  readonly mtimeMs: number
  readonly size: number
}

const APPEND_FD_CAP = 16

export class TaskRecordCollisionError extends Error {
  readonly taskId: TaskId
  readonly path: string

  constructor(input: { readonly taskId: TaskId; readonly path: string }) {
    super(`Task record already exists: ${input.taskId}`)
    this.name = "TaskRecordCollisionError"
    this.taskId = input.taskId
    this.path = input.path
  }
}

export function createTaskRecordStore(config: StateDirConfig): TaskRecordStore {
  const stateDir = resolveStateDir(config)
  const cache = new Map<string, CacheEntry>()
  const appendFds = new Map<string, number>()

  function cacheSet(path: string): void {
    const record = readRecord(path)
    if (record === null) return
    const stat = statSync(path)
    cache.set(path, { record, mtimeMs: stat.mtimeMs, size: stat.size })
  }

  return {
    stateDir,
    save(record) {
      writeRecord(stateDir, record, "create")
      cacheSet(taskPath(stateDir, parseTaskId(record.task_id)))
    },
    replace(record) {
      const taskId = parseTaskId(record.task_id)
      writeRecord(stateDir, record, "replace")
      cacheSet(taskPath(stateDir, taskId))
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
      const record = readCached(path, cache)
      if (record === null) throw new Error(`Task record not found: ${taskId}`)
      const result = transitionTaskRecord(record, transition)
      appendTaskEvent(stateDir, parsedTaskId, { type: result.audit.type, payload: result.audit }, appendFds)
      if (result.applied) {
        writeRecord(stateDir, result.record, "replace")
        cacheSet(path)
      }
      return result
    },
    remove(taskId) {
      const parsedTaskId = parseTaskId(taskId)
      removeRecord(stateDir, parsedTaskId, cache, appendFds)
    },
  }
}

function removeRecord(
  stateDir: string,
  taskId: TaskId,
  cache: Map<string, CacheEntry>,
  appendFds: Map<string, number>,
): void {
  const recordPath = taskPath(stateDir, taskId)
  const logPath = join(stateDir, "logs", `${taskId}.jsonl`)
  rmSync(recordPath, { force: true })
  rmSync(logPath, { force: true })
  cache.delete(recordPath)
  const fd = appendFds.get(logPath)
  if (fd !== undefined) {
    appendFds.delete(logPath)
    closeSync(fd)
  }
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
      if (record !== null) records.push(record)
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

  const record = readRecord(path)
  if (record !== null) cache.set(path, { record, mtimeMs: stat.mtimeMs, size: stat.size })
  return record
}

function readRecord(path: string): TaskRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    return parseTaskRecord(parsed, path)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

function writeRecord(stateDir: string, record: TaskRecord, mode: WriteRecordMode): void {
  const tasksDir = join(stateDir, "tasks")
  mkdirSync(tasksDir, { recursive: true })
  const taskId = parseTaskId(record.task_id)
  const path = taskPath(stateDir, taskId)
  const payload = JSON.stringify(record)
  if (mode === "create") {
    try {
      writeFileSync(path, payload, { encoding: "utf8", flag: "wx" })
      return
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new TaskRecordCollisionError({ taskId, path })
      }
      throw error
    }
  }

  const tmpPath = `${path}.${process.pid}.tmp`
  writeFileSync(tmpPath, payload, "utf8")
  renameSync(tmpPath, path)
}

function appendTaskEvent(
  stateDir: string,
  taskId: TaskId,
  event: PersistedTaskEvent,
  appendFds: Map<string, number>,
): string {
  const logsDir = join(stateDir, "logs")
  mkdirSync(logsDir, { recursive: true })
  const path = join(logsDir, `${taskId}.jsonl`)
  const line = `${JSON.stringify({ type: event.type, payload: redactEventPayload(event.payload) })}
`
  const fd = appendFdFor(path, appendFds)
  writeSync(fd, line)
  return path
}

function appendFdFor(path: string, appendFds: Map<string, number>): number {
  const existing = appendFds.get(path)
  if (existing !== undefined) {
    // Move to the end to keep LRU order.
    appendFds.delete(path)
    appendFds.set(path, existing)
    return existing
  }

  const fd = openSync(path, "a")
  appendFds.set(path, fd)
  if (appendFds.size > APPEND_FD_CAP) {
    const [oldPath, oldFd] = appendFds.entries().next().value as [string, number]
    appendFds.delete(oldPath)
    closeSync(oldFd)
  }
  return fd
}

function taskPath(stateDir: string, taskId: TaskId): string {
  return join(stateDir, "tasks", `${taskId}.json`)
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
