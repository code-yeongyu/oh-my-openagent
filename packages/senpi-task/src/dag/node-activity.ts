import * as fs from "node:fs"

import { taskEventLogPath } from "../store/event-log"

/**
 * Dates a running node's child by its transcript log: the manager appends one line per assistant
 * message and per tool call, so the file's mtime is the last moment the child actually did
 * something. TaskRecord.updated_at cannot answer this - it only moves on status and residency
 * transitions, so a child that has been silent for an hour still reads as freshly updated (#8674).
 *
 * EVERY fault reads as "no activity recorded", not just the missing file `throwIfNoEntry` covers.
 * This runs inside projectSnapshot, which the rpc bridge and the status UI call on timers, where a
 * throw is an uncaughtException that ends the session - and win32 answers a stat on a file an
 * indexer is holding with a sharing violation (#8672). An advisory clock must never cost a session.
 */
export function readDagNodeActivityAt(stateDir: string, taskId: string): string | undefined {
  try {
    const stats = fs.statSync(taskEventLogPath(stateDir, taskId), { throwIfNoEntry: false })
    return stats === undefined ? undefined : new Date(stats.mtimeMs).toISOString()
  } catch {
    return undefined
  }
}
