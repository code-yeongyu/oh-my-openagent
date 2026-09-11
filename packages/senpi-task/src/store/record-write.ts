import { randomBytes } from "node:crypto"
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { parseTaskId } from "../state"
import type { TaskId, TaskRecord } from "../state"

export type WriteRecordMode = "create" | "replace"

// Windows may refuse the rename with a sharing violation while Defender, an indexer, or another
// senpi process still holds the record or its temp file (#8050). Bounded retry with a short
// synchronous backoff, mirroring the DAG store's cleanup retry; any other platform, errno, or the
// final attempt rethrows unchanged.
const WINDOWS_RENAME_RETRIES = 8
const WINDOWS_RENAME_RETRY_MS = 5
const WINDOWS_TRANSIENT_CODES: ReadonlySet<string> = new Set(["EPERM", "EBUSY", "EACCES"])
const sleeper = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))

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

export function writeRecord(path: string, record: TaskRecord, mode: WriteRecordMode, platform: NodeJS.Platform): void {
  mkdirSync(dirname(path), { recursive: true })
  const payload = JSON.stringify(record)
  if (mode === "create") {
    try {
      writeFileSync(path, payload, { encoding: "utf8", flag: "wx" })
      return
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new TaskRecordCollisionError({ taskId: parseTaskId(record.task_id), path })
      }
      throw error
    }
  }

  // pid + random segment: two writers in one process (or a pid reused across a crash) never share
  // a temp name, and the finally leaves nothing behind when the rename is refused.
  const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  try {
    writeFileSync(tmpPath, payload, "utf8")
    renameWithWindowsRetry(tmpPath, path, platform)
  } finally {
    rmSync(tmpPath, { force: true })
  }
}

function renameWithWindowsRetry(from: string, to: string, platform: NodeJS.Platform): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      if (platform !== "win32" || attempt >= WINDOWS_RENAME_RETRIES || !isTransientWindowsError(error)) throw error
      Atomics.wait(sleeper, 0, 0, WINDOWS_RENAME_RETRY_MS)
    }
  }
}

function isTransientWindowsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && WINDOWS_TRANSIENT_CODES.has(error.code)
}
