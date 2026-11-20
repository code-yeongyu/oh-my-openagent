// A TaskRecordStore that keeps records, event logs and expunge tombstones in process memory.
//
// The DAG e2e cases (#11632) run the real task manager, and every record write through the file store
// costs a lock create/publish/release, a stat-validated cache read and a temp+rename replace. That cost
// is paid in contended host I/O, so the ordering case's wall time scaled with the machine's load: at a
// 20 ms syscall latency it took 19 s against a 15 s budget even with the DAG journal in memory.
//
// Fidelity, in the order a caller can observe it:
// - Records round-trip through the file store's own serializer (toStorableTaskRecord) and parser
//   (parseTaskRecord), so a field the store drops, or a record it refuses, behaves identically here.
// - save refuses an existing id with TaskRecordCollisionError; mutate skips the write when the mutation
//   returns its input; transition appends the audit event and writes only an applied transition.
// - Tombstones keep the file store's ownership rules: invisible to load/list/mutate, restored only over
//   a missing record and only by their owner, and handed over only from the recorded owner.
// - appendEvent returns the path the file store's log would have, and payloads are redacted the same way.
//
// - withOwnerLock serializes concurrent async callers per owner key, as the file store's cross-process
//   lock does within one process.
//
// Deliberately NOT emulated: the record lock is a no-op (single-threaded JS already serializes these
// synchronous sections and there is no second process), and remove/completeExpunge still delete the real
// children/ and completion-results/ paths, because other writers put session transcripts and spill files
// there directly.
import { rmSync } from "node:fs"
import { join } from "node:path"

import { parseTaskId, transitionTaskRecord, type TaskRecord } from "../../state"
import { taskEventLogPath } from "../event-log"
import { TaskRecordCollisionError } from "../record-write"
import { parseTaskRecord } from "../record-parse"
import { redactEventPayload } from "../redaction"
import { toStorableTaskRecord } from "../storable-record"
import type { ExpungeOwner, PersistedTaskEvent, TaskRecordStore } from "../types"

type Tombstone = { readonly serialized: string; owner: ExpungeOwner | undefined }

export type InMemoryTaskRecordStore = TaskRecordStore & {
  readonly events: (taskId: string) => readonly PersistedTaskEvent[]
}

function sameOwner(left: ExpungeOwner | undefined, right: ExpungeOwner | undefined): boolean {
  return left !== undefined && right !== undefined && left.pid === right.pid && left.token === right.token
}

export function createInMemoryTaskRecordStore(stateDir: string): InMemoryTaskRecordStore {
  const records = new Map<string, string>()
  const tombstones = new Map<string, Tombstone>()
  const eventLogs = new Map<string, PersistedTaskEvent[]>()
  const ownerLockTails = new Map<string, Promise<unknown>>()
  const recordPath = (taskId: string): string => join(stateDir, "tasks", `${taskId}.json`)
  const serialize = (record: TaskRecord): string => JSON.stringify(toStorableTaskRecord(record))
  const parse = (taskId: string, serialized: string): TaskRecord =>
    parseTaskRecord(JSON.parse(serialized), recordPath(taskId))
  const read = (taskId: string): TaskRecord | null => {
    const serialized = records.get(String(parseTaskId(taskId)))
    return serialized === undefined ? null : parse(taskId, serialized)
  }
  const appendEvent = (taskId: string, event: PersistedTaskEvent): string => {
    const id = String(parseTaskId(taskId))
    const log = eventLogs.get(id) ?? []
    log.push(JSON.parse(JSON.stringify({ type: event.type, payload: redactEventPayload(event.payload) })))
    eventLogs.set(id, log)
    return taskEventLogPath(stateDir, id)
  }
  const removeArtifacts = (taskId: string): void => {
    rmSync(join(stateDir, "children", taskId), { recursive: true, force: true })
    rmSync(join(stateDir, "completion-results", `${taskId}.txt`), { force: true })
    eventLogs.delete(taskId)
    records.delete(taskId)
  }

  return {
    stateDir,
    events: (taskId) => [...(eventLogs.get(String(parseTaskId(taskId))) ?? [])],
    save(record) {
      const taskId = parseTaskId(record.task_id)
      if (records.has(String(taskId))) throw new TaskRecordCollisionError({ taskId, path: recordPath(taskId) })
      records.set(String(taskId), serialize(record))
    },
    replace(record) {
      records.set(String(parseTaskId(record.task_id)), serialize(record))
    },
    mutate(taskId, mutation) {
      const current = read(taskId)
      if (current === null) return null
      const next = mutation(current)
      if (next !== current) records.set(String(parseTaskId(taskId)), serialize(next))
      return next
    },
    load: read,
    list() {
      const ids = [...records.keys()].toSorted()
      return { records: ids.map((id) => parse(id, records.get(id) ?? "")), diagnostics: [] }
    },
    appendEvent,
    transition(taskId, transition) {
      const record = read(taskId)
      if (record === null) throw new Error(`Task record not found: ${taskId}`)
      const result = transitionTaskRecord(record, transition)
      appendEvent(taskId, { type: result.audit.type, payload: result.audit })
      if (result.applied) records.set(String(parseTaskId(taskId)), serialize(result.record))
      return result
    },
    remove(taskId) {
      removeArtifacts(String(parseTaskId(taskId)))
    },
    tombstoneIfExpired(taskId, shouldRetain, owner) {
      const id = String(parseTaskId(taskId))
      const serialized = records.get(id)
      if (serialized === undefined) return { kind: "missing" }
      const current = parse(id, serialized)
      if (shouldRetain(current)) return { kind: "retained" }
      tombstones.set(id, { serialized, owner })
      records.delete(id)
      return { kind: "tombstoned", record: current }
    },
    completeExpunge(taskId, owner) {
      const id = String(parseTaskId(taskId))
      if (owner !== undefined && !sameOwner(tombstones.get(id)?.owner, owner)) return false
      removeArtifacts(id)
      tombstones.delete(id)
      return true
    },
    // The file store's owner lock spans an await, so two async starts for one owner can interleave in
    // one process; a no-op here would let both spawn. Chain them per key instead.
    withOwnerLock(ownerKey, operation) {
      const previous = ownerLockTails.get(ownerKey) ?? Promise.resolve()
      const run = previous.then(operation, operation)
      const tail = run.then(
        () => undefined,
        () => undefined,
      )
      ownerLockTails.set(ownerKey, tail)
      void tail.then(() => {
        if (ownerLockTails.get(ownerKey) === tail) ownerLockTails.delete(ownerKey)
      })
      return run
    },
    listExpunging: () => [...tombstones.keys()].toSorted(),
    loadExpunging(taskId) {
      const id = String(parseTaskId(taskId))
      const tombstone = tombstones.get(id)
      return tombstone === undefined ? null : parse(id, tombstone.serialized)
    },
    restoreExpunging(taskId, owner) {
      const id = String(parseTaskId(taskId))
      const tombstone = tombstones.get(id)
      if (tombstone === undefined || records.has(id)) return
      if (owner !== undefined && !sameOwner(tombstone.owner, owner)) return
      records.set(id, tombstone.serialized)
      tombstones.delete(id)
    },
    readExpungeOwner: (taskId) => tombstones.get(String(parseTaskId(taskId)))?.owner,
    takeOverExpunging(taskId, from, to) {
      const tombstone = tombstones.get(String(parseTaskId(taskId)))
      if (tombstone === undefined) return false
      if (tombstone.owner === undefined ? from !== undefined : !sameOwner(tombstone.owner, from)) return false
      tombstone.owner = to
      return true
    },
  }
}
