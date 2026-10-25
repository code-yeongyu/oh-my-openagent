import { watch } from "node:fs"
import { join } from "node:path"
import { readRecords } from "./task-rpc-e2e-helpers.mjs"

const runningRpcChild = (r) => r.execution_mode === "process" && r.status === "running" && typeof r.pid === "number"

// The task state may not exist yet, or a record may be mid-write: neither is a harness failure.
export function readRecordsLenient(stateDir) {
  try {
    return readRecords(stateDir)
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return []
    throw error
  }
}

const RECORD_RECHECK_MS = 250

export function waitForRecord(stateDir, predicate, timeoutMs, signal) {
  const tasksDir = join(stateDir, "tasks")
  const logsDir = join(stateDir, "logs")
  const find = () => readRecordsLenient(stateDir).find(predicate)
  if (signal?.aborted) return Promise.resolve(undefined)
  const existing = find()
  if (existing !== undefined) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    let settled = false
    const watchers = [tasksDir, logsDir].map((dir) => watch(dir, { persistent: false }, () => {
      const match = find()
      if (match !== undefined) finish(match)
    }))
    // File watchers drop events under load (macOS FSEvents, Windows runners), and a dropped create
    // event would read as a missing child. A short re-read backs the watchers up until the wait ends.
    const recheck = setInterval(() => {
      const match = find()
      if (match !== undefined) finish(match)
    }, RECORD_RECHECK_MS)
    recheck.unref?.()
    const closeWatchers = () => {
      clearInterval(recheck)
      watchers.forEach((watcher) => watcher.close())
      signal?.removeEventListener("abort", abort)
    }
    const finish = (match) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      closeWatchers()
      resolve(match)
    }
    const abort = () => finish(undefined)
    const timeout = setTimeout(abort, timeoutMs)
    signal?.addEventListener("abort", abort, { once: true })
    for (const watcher of watchers) {
      watcher.on("error", (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        closeWatchers()
        reject(error)
      })
    }
    // The producer may have completed an atomic write between the initial read and watch setup.
    const match = find()
    if (match !== undefined) finish(match)
  })
}

// The parent's session can return before its process child's completion is written to the task record:
// on a slow Windows runner that write lands moments later (#9481). Wait for it instead of reading once.
const PROCESS_COMPLETION_MS = 60_000

const isCompletedProcessTask = (r) => r.status === "completed" && r.execution_mode === "process"

/**
 * Waits for a process-mode task record to reach `completed`. Returns `{ completed: true }`, or, when the
 * deadline passes first, `{ completed: false, lastStatuses }` with the process tasks' last seen statuses.
 */
export async function waitForProcessCompletion(stateDir, timeoutMs = PROCESS_COMPLETION_MS) {
  const done = await waitForRecord(stateDir, isCompletedProcessTask, timeoutMs)
  if (done !== undefined) return { completed: true }
  const lastStatuses = readRecordsLenient(stateDir)
    .filter((r) => r.execution_mode === "process")
    .map((r) => r.status)
  return { completed: false, lastStatuses }
}

// The parent Senpi host starts cold on every scenario: on a loaded Windows runner its startup alone
// can take most of a minute before it even creates the task. Give that phase its own budget, then
// time the child spawn separately, so a slow parent start is not misread as a missing child.
const PARENT_TASK_CREATE_MS = 120_000
const CHILD_SPAWN_MS = 40_000

export async function waitForRunningRpcChild(stateDir, name, budgets = {}) {
  const { parentTaskCreateMs = PARENT_TASK_CREATE_MS, childSpawnMs = CHILD_SPAWN_MS, signal, onCreated } = budgets
  const created = await waitForRecord(stateDir, (r) => r.name === name, parentTaskCreateMs, signal)
  if (created === undefined) return undefined
  onCreated?.(created)
  return waitForRecord(stateDir, (r) => r.name === name && runningRpcChild(r), childSpawnMs, signal)
}
