import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
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

export function createTaskRecordStore(config: StateDirConfig): TaskRecordStore {
  const stateDir = resolveStateDir(config)
  return {
    stateDir,
    save(record) {
      writeRecord(stateDir, record)
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
      if (result.applied) writeRecord(stateDir, result.record)
      return result
    },
  }
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
      diagnostics.push({ type: "parse_error", path, message: errorMessage(error) })
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

function writeRecord(stateDir: string, record: TaskRecord): void {
  const tasksDir = join(stateDir, "tasks")
  mkdirSync(tasksDir, { recursive: true })
  const path = taskPath(stateDir, parseTaskId(record.task_id))
  const tmpPath = `${path}.${process.pid}.tmp`
  writeFileSync(tmpPath, JSON.stringify(record, null, 2), "utf8")
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
