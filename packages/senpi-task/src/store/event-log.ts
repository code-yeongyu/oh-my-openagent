import { closeSync, mkdirSync, openSync, writeSync } from "node:fs"
import { join } from "node:path"

import type { TaskId } from "../state"
import { redactEventPayload } from "./redaction"
import type { PersistedTaskEvent } from "./types"

export type AppendFdCache = Map<string, number>

const APPEND_FD_CAP = 16

export function appendTaskEvent(
  stateDir: string,
  taskId: TaskId,
  event: PersistedTaskEvent,
  appendFds: AppendFdCache,
): string {
  const logsDir = join(stateDir, "logs")
  mkdirSync(logsDir, { recursive: true })
  const path = join(logsDir, `${taskId}.jsonl`)
  const line = `${JSON.stringify({ type: event.type, payload: redactEventPayload(event.payload) })}\n`
  writeSync(appendFdFor(path, appendFds), line)
  return path
}

export function closeAppendFd(path: string, appendFds: AppendFdCache): void {
  const fd = appendFds.get(path)
  if (fd === undefined) return
  appendFds.delete(path)
  closeSync(fd)
}

function appendFdFor(path: string, appendFds: AppendFdCache): number {
  const existing = appendFds.get(path)
  if (existing !== undefined) {
    appendFds.delete(path)
    appendFds.set(path, existing)
    return existing
  }

  const fd = openSync(path, "a")
  appendFds.set(path, fd)
  if (appendFds.size > APPEND_FD_CAP) {
    const oldest = appendFds.entries().next().value as [string, number]
    appendFds.delete(oldest[0])
    closeSync(oldest[1])
  }
  return fd
}
