import { closeSync, mkdirSync, openSync, writeSync } from "node:fs"
import { join } from "node:path"

import type { TaskId } from "../state"
import { redactEventPayload } from "./redaction"
import type { PersistedTaskEvent } from "./types"

export type AppendFdCache = Map<string, number>

const APPEND_FD_CAP = 16

// Exported so every reader shares ONE definition of the layout: the dag node activity clock stats
// this file to date a live child's last transcript write, and removeRecord unlinks it.
export function taskEventLogPath(stateDir: string, taskId: string): string {
  return join(stateDir, "logs", `${taskId}.jsonl`)
}

export function appendTaskEvent(
  stateDir: string,
  taskId: TaskId,
  event: PersistedTaskEvent,
  appendFds: AppendFdCache,
): string {
  mkdirSync(join(stateDir, "logs"), { recursive: true })
  const path = taskEventLogPath(stateDir, taskId)
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
