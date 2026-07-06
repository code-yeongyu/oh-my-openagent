import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
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
  return {
    stateDir,
    save(record) {
      writeRecord(stateDir, record, "create")
    },
    replace(record) {
      writeRecord(stateDir, record, "replace")
    },
    load(taskId) {
      const path = taskPath(stateDir, parseTaskId(taskId))
      return readRecord(path)
    },
    list() {
      return listRecords(stateDir)
    },
    appendEvent(taskId, event) {
      return appendTaskEvent(stateDir, parseTaskId(taskId), event)
    },
    transition(taskId, transition) {
      const parsedTaskId = parseTaskId(taskId)
      const record = readRecord(taskPath(stateDir, parsedTaskId))
      if (record === null) throw new Error(`Task record not found: ${taskId}`)
      const result = transitionTaskRecord(record, transition)
      appendTaskEvent(stateDir, parsedTaskId, { type: result.audit.type, payload: result.audit })
      if (result.applied) writeRecord(stateDir, result.record, "replace")
      return result
    },
    remove(taskId) {
      removeRecord(stateDir, parseTaskId(taskId))
    },
  }
}

function removeRecord(stateDir: string, taskId: TaskId): void {
  rmSync(taskPath(stateDir, taskId), { force: true })
  rmSync(join(stateDir, "logs", `${taskId}.jsonl`), { force: true })
}

function listRecords(stateDir: string): ListTaskRecordsResult {
  const tasksDir = join(stateDir, "tasks")
  mkdirSync(tasksDir, { recursive: true })
  const records: TaskRecord[] = []
  const diagnostics: TaskRecordDiagnostic[] = []

  for (const file of readdirSync(tasksDir).filter((entry) => entry.endsWith(".json")).toSorted()) {
    const path = join(tasksDir, file)
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
      records.push(parseTaskRecord(parsed, path))
    } catch (error) {
      if (!(error instanceof Error)) throw error
      diagnostics.push({ type: "parse_error", path, message: error.message })
    }
  }

  return { records, diagnostics }
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
  const payload = JSON.stringify(record, null, 2)
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

function appendTaskEvent(stateDir: string, taskId: TaskId, event: PersistedTaskEvent): string {
  const logsDir = join(stateDir, "logs")
  mkdirSync(logsDir, { recursive: true })
  const path = join(logsDir, `${taskId}.jsonl`)
  const line = JSON.stringify({ type: event.type, payload: redactEventPayload(event.payload) })
  writeFileSync(path, `${line}\n`, { encoding: "utf8", flag: "a" })
  return path
}

function taskPath(stateDir: string, taskId: TaskId): string {
  return join(stateDir, "tasks", `${taskId}.json`)
}
