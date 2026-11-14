// A DagFileStore that keeps the WAL, checkpoints, keys and results in process memory.
//
// Retry-semantics cases (#11621) assert the scheduler's behaviour, never crash durability, yet the file
// store charges every journal commit a run-lock create/unlink, a WAL append, several full WAL rescans
// and a temp+rename checkpoint. That cost is paid in contended host I/O, so a case's wall time scales
// with whatever else the machine is doing: a 12-commit case measured 31 ms idle and 2,059 ms under load,
// against Bun's fixed 5 s default. Durability is covered by store.test.ts and the e2e cases.
//
// Fidelity, in the order a caller can observe it:
// - Refusals come from the file store's OWN validators (assertSupportedSchema, assertSafeSegment), so a
//   journal regression that drops schemaVersion or names an unsafe run id fails here exactly as on disk.
// - Seq must be strictly increasing, with the file store's error text; pages carry the same
//   headSeq/hasMore/nextSinceSeq; events and checkpoints round-trip through JSON plus the paused
//   encoding, so no caller can hold a live reference to stored state.
// - Locks refuse a nested acquire of the same lock, as the file store does (there a second create of a
//   live lock file ends in "Timed out acquiring DAG lock"); it is refused at once rather than after the
//   file store's 1 s stall. Beyond that a lock is a no-op: mutual exclusion between synchronous sections
//   is what single-threaded JS already provides, and there is no second process to exclude.
//
// Deliberately NOT emulated, because no case here depends on it:
// - `paths` still name real disk locations, and the few writers that bypass the store (results.ts's
//   result artifacts, skills materialization) therefore still write under <stateDir>/dag/results and
//   /skills. The cases assert through store.readEvents/readCheckpoint and the scheduler record, never
//   through those files, and the journal directories the cost lives in (events, runs, locks, keys) stay
//   empty - the test file asserts exactly that. Routing those readers through the store is #11629.
// - `pruneExpired` returns nothing and `writeCheckpoint` does not enforce max_runs_per_session: both are
//   file-store retention/capacity concerns, covered by store.test.ts, and a memory store is discarded
//   with its test.
import { basename, join } from "node:path"

import { decodePausedNodes, decodePausedTransition, encodePausedNodes, encodePausedTransition } from "../paused-node-encoding"
import { assertSafeSegment, assertSupportedSchema, dagKeyHash, type DagEventPage, type DagFileStore, type DagKeyRecord, type DagStorePaths } from "../store"
import type { DagRunEvent, DagRunId } from "../types"

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function memoryPaths(stateDir: string): DagStorePaths {
  const root = join(stateDir, "dag")
  const keys = join(root, "keys")
  const runs = join(root, "runs")
  const events = join(root, "events")
  const results = join(root, "results")
  const locks = join(root, "locks")
  return {
    root, keys, runs, events, results, locks,
    key: (parentSessionId, runKey) => join(keys, `${dagKeyHash(parentSessionId, runKey)}.json`),
    run: (runId) => join(runs, `${runId}.json`),
    event: (runId) => join(events, `${runId}.jsonl`),
    result: (runId, nodeId) => {
      assertSafeSegment(runId, "run id")
      assertSafeSegment(nodeId, "node id")
      return join(results, runId, `${nodeId}.txt`)
    },
    runLock: (runId) => join(locks, `${runId}.lock`),
    keyLock: (parentSessionId, runKey) => join(locks, `key-${dagKeyHash(parentSessionId, runKey)}.lock`),
    taskOwnerLock: (taskOwner) => join(locks, `task-owner-${taskOwner}.lock`),
  }
}

export function createInMemoryDagStore(stateDir = "/memory/.omo/senpi-task", now: () => number = Date.now): DagFileStore {
  const paths = memoryPaths(stateDir)
  const eventsByRun = new Map<DagRunId, DagRunEvent[]>()
  const checkpoints = new Map<DagRunId, object>()
  const keys = new Map<string, DagKeyRecord>()
  const results = new Map<string, string>()
  const heldLocks = new Set<string>()
  function withLock<T>(path: string, operation: () => T): T {
    assertSafeSegment(basename(path), "lock name")
    if (heldLocks.has(path)) throw new Error(`Timed out acquiring DAG lock: ${path}`)
    heldLocks.add(path)
    try {
      return operation()
    } finally {
      heldLocks.delete(path)
    }
  }
  return {
    stateDir,
    paths,
    diagnostics: () => [],
    appendEvent(event) {
      assertSafeSegment(event.runId, "run id")
      assertSupportedSchema(event, paths.event(event.runId), event.runId, now)
      const log = eventsByRun.get(event.runId) ?? []
      const expectedSeq = (log.at(-1)?.seq ?? 0) + 1
      if (!Number.isSafeInteger(event.seq) || event.seq !== expectedSeq) {
        throw new Error(`DAG event seq must be strictly increasing: expected ${expectedSeq}, received ${event.seq}`)
      }
      log.push(clone(encodePausedTransition(event)))
      eventsByRun.set(event.runId, log)
    },
    readEvents(runId, sinceSeqExclusive, options): DagEventPage {
      assertSafeSegment(runId, "run id")
      if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new Error("event page limit must be a positive integer")
      }
      const log = eventsByRun.get(runId) ?? []
      const wantedTypes = options.types === undefined ? undefined : new Set(options.types)
      const events: DagRunEvent[] = []
      let headSeq = 0
      let hasMore = false
      for (const stored of log) {
        const event = decodePausedTransition(clone(stored))
        headSeq = Math.max(headSeq, event.seq)
        if (event.seq <= sinceSeqExclusive) continue
        if (options.throughSeq !== undefined && event.seq > options.throughSeq) continue
        if (options.lane !== undefined && event.lane !== options.lane) continue
        if (wantedTypes !== undefined && !wantedTypes.has(event.type)) continue
        if (events.length < options.limit) events.push(event)
        else hasMore = true
      }
      return { events, nextSinceSeq: events.at(-1)?.seq ?? sinceSeqExclusive, headSeq, hasMore }
    },
    writeCheckpoint(runId, checkpoint) {
      assertSafeSegment(runId, "run id")
      assertSupportedSchema(checkpoint, paths.run(runId), runId, now)
      checkpoints.set(runId, clone(encodePausedNodes(checkpoint)))
    },
    readCheckpoint<T extends object>(runId: DagRunId): T | null {
      assertSafeSegment(runId, "run id")
      const stored = checkpoints.get(runId)
      if (stored === undefined) return null
      assertSupportedSchema(stored, paths.run(runId), runId, now)
      return decodePausedNodes(clone(stored) as T)
    },
    writeKey(record) {
      const path = paths.key(record.parentSessionId, record.runKey)
      assertSupportedSchema(record, path, record.runId, now)
      keys.set(dagKeyHash(record.parentSessionId, record.runKey), clone(record))
      return path
    },
    readKey(parentSessionId, runKey) {
      const stored = keys.get(dagKeyHash(parentSessionId, runKey))
      if (stored === undefined) return null
      assertSupportedSchema(stored, paths.key(parentSessionId, runKey), stored.runId, now)
      return clone(stored)
    },
    writeResult(runId, nodeId, result) {
      const path = paths.result(runId, nodeId)
      results.set(`${runId}\u0000${nodeId}`, result)
      return path
    },
    readResult(runId, nodeId) {
      paths.result(runId, nodeId)
      return results.get(`${runId}\u0000${nodeId}`) ?? null
    },
    withRunLock(runId, operation) {
      assertSafeSegment(runId, "run id")
      return withLock(paths.runLock(runId), operation)
    },
    withKeyLock: (parentSessionId, runKey, operation) => withLock(paths.keyLock(parentSessionId, runKey), operation),
    withTaskOwnerLock: (taskOwner, runId, operation) => withLock(paths.taskOwnerLock(taskOwner), () => {
      assertSafeSegment(runId, "run id")
      return operation()
    }),
    withSessionRunCapacity: (parentSessionId, _runId, operation) =>
      withLock(join(paths.locks, `session-runs-${dagKeyHash(parentSessionId, "session-runs")}.lock`), operation),
    pruneExpired: () => [],
  }
}
