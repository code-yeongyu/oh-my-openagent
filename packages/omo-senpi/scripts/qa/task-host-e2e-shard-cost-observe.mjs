import { observeState } from "./task-host-e2e-events.mjs"
import { waitFor } from "./task-host-e2e-process.mjs"
import {
  endpointSockets,
  hostStatus,
  processTable,
  sampleEndpoint,
  supervisorPid,
  taskRecords,
} from "./task-host-e2e-shard-cost-support.mjs"

const DONE = new Set(["completed", "error", "lost", "cancelled"])

export async function until(sandbox, probe, timeoutMs = 600_000) {
  return observeState(sandbox.root, probe, { timeoutMs })
}

export function settled(project, count) {
  const records = taskRecords(project)
  return records.length >= count && records.every((record) => DONE.has(record.status)) ? records : undefined
}

export async function reachable(sandbox, socket, timeoutMs = 60_000) {
  return waitFor(
    () => (hostStatus(sandbox, socket, { includeWorkers: false }).json?.reachable === true ? true : undefined),
    { timeoutMs, intervalMs: 250 },
  )
}

export async function newSocket(sandbox, known, timeoutMs = 60_000) {
  return until(sandbox, () => endpointSockets(sandbox).find((socket) => !known.has(socket)), timeoutMs)
}

export function sampleAll(sandbox) {
  const table = processTable()
  return endpointSockets(sandbox).map((socket) => sampleEndpoint(socket, supervisorPid(sandbox, socket), table))
}
