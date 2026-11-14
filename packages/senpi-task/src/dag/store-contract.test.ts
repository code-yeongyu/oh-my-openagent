// One contract, two stores: the retry cases (#11621) journal to the in-memory store, so a refusal the
// file store makes and it does not would let a journal regression pass here and fail on disk. Each case
// runs against createDagFileStore in a temp directory AND createInMemoryDagStore.
import { afterAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createInMemoryDagStore } from "./__fixtures__/in-memory-store"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagRunEvent, DagRunId } from "./types"

const projects: string[] = []
afterAll(() => {
  for (const project of projects.splice(0)) fs.rmSync(project, { recursive: true, force: true })
})

function fileStore(): DagFileStore {
  const project = fs.mkdtempSync(join(tmpdir(), "dag-store-contract-"))
  projects.push(project)
  return createDagFileStore({ project_dir: project }, { fsync: false })
}

const RUN_ID = "dag_contract" as DagRunId

function event(seq: number, overrides: Partial<DagRunEvent> = {}): DagRunEvent {
  return {
    schemaVersion: 1, runId: RUN_ID, seq, at: "2026-10-19T00:00:00.000Z", lane: "lifecycle",
    type: "dag.run.started", generation: 1, ...overrides,
  } as DagRunEvent
}

const stores: ReadonlyArray<readonly [string, () => DagFileStore]> = [
  ["file store", fileStore],
  // The memory store never touches disk, so it gets a path, not a directory.
  ["in-memory store", () => createInMemoryDagStore(join(tmpdir(), "dag-store-contract-memory"))],
]

for (const [name, create] of stores) {
  describe(`DAG store contract: ${name}`, () => {
    test("#given an event without a supported schemaVersion #when appended #then it is refused", () => {
      const store = create()
      expect(() => store.appendEvent(event(1, { schemaVersion: 2 as 1 }))).toThrow(/schemaVersion/)
      expect(() => store.appendEvent({ ...event(1), schemaVersion: undefined } as unknown as DagRunEvent)).toThrow(/schemaVersion/)
    })

    test("#given a checkpoint without a supported schemaVersion #when written #then it is refused", () => {
      const store = create()
      expect(() => store.writeCheckpoint(RUN_ID, { schemaVersion: 2, checkpointSeq: 0 })).toThrow(/schemaVersion/)
    })

    test("#given a key record without a supported schemaVersion #when written #then it is refused", () => {
      const store = create()
      const key = { schemaVersion: 2, parentSessionId: "parent", runKey: "key", runId: RUN_ID }
      expect(() => store.writeKey(key as never)).toThrow(/schemaVersion/)
    })

    test("#given an unsafe run id #when the run lock is taken #then it is refused", () => {
      const store = create()
      expect(() => store.withRunLock("../escape" as DagRunId, () => undefined)).toThrow(/Invalid run id/)
    })

    test("#given the run lock is held #when the same run is locked again #then the nested acquire is refused", () => {
      const store = create()
      expect(() => store.withRunLock(RUN_ID, () => store.withRunLock(RUN_ID, () => undefined))).toThrow(/DAG lock/)
      // The lock is released by the refused attempt's unwind, so the next acquire still succeeds.
      expect(store.withRunLock(RUN_ID, () => "acquired")).toBe("acquired")
    })

    test("#given a log of five events #when paged #then the cursor, headSeq and hasMore match", () => {
      const store = create()
      for (let seq = 1; seq <= 5; seq += 1) store.appendEvent(event(seq))
      const first = store.readEvents(RUN_ID, 0, { limit: 2 })
      expect(first.events.map((entry) => entry.seq)).toEqual([1, 2])
      expect(first.nextSinceSeq).toBe(2)
      expect(first.headSeq).toBe(5)
      expect(first.hasMore).toBe(true)
      const last = store.readEvents(RUN_ID, first.nextSinceSeq, { limit: 10 })
      expect(last.events.map((entry) => entry.seq)).toEqual([3, 4, 5])
      expect(last.hasMore).toBe(false)
      expect(store.readEvents(RUN_ID, 5, { limit: 10 }).events).toEqual([])
      expect(store.readEvents(RUN_ID, 0, { limit: 10, throughSeq: 3 }).events.map((entry) => entry.seq)).toEqual([1, 2, 3])
      expect(() => store.readEvents(RUN_ID, 0, { limit: 0 })).toThrow(/positive integer/)
    })

    test("#given a gapped seq #when appended #then it is refused with the strictly-increasing error", () => {
      const store = create()
      store.appendEvent(event(1))
      expect(() => store.appendEvent(event(3))).toThrow(/strictly increasing: expected 2, received 3/)
    })
  })
}
