import { afterEach, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagManager, type DagRunRecordV1 } from "./manager"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagRunId } from "./types"

const cleanupRoots: string[] = []
const parentSessionId = "ses_parent"
const otherSessionId = "ses_other"

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-list-cache-"))
  cleanupRoots.push(directory)
  return directory
}

// Counts the checkpoint parses `list()` performs. The DAG status widget repaints at 1Hz and the
// runtime's mutation listener re-lists on every checkpoint write, so this count IS the render cost:
// on a real state dir it was 710 parses / 68MB / 473ms per call before the summary cache.
type CountingStore = {
  readonly store: DagFileStore
  readonly reads: () => number
  readonly reset: () => void
}

function countingStore(base: DagFileStore): CountingStore {
  let reads = 0
  const store: DagFileStore = {
    ...base,
    readCheckpoint<T extends object>(runId: DagRunId): T | null {
      reads += 1
      return base.readCheckpoint<T>(runId)
    },
  }
  return { store, reads: () => reads, reset: () => { reads = 0 } }
}

async function seedRuns(dag: ReturnType<typeof createDagManager>, sessionId: string, count: number): Promise<DagRunId[]> {
  const ids: DagRunId[] = []
  for (let index = 0; index < count; index += 1) {
    const started = await dag.start({
      definition: {
        key: `${sessionId}-key-${index}`,
        name: `run ${index}`,
        nodes: [{ id: "only", prompt: "do the thing", category: "quick" }],
      },
      parentSessionId: sessionId,
      rootSessionId: sessionId,
    })
    ids.push(started.snapshot.runId)
  }
  return ids
}

test("list() serves unchanged checkpoints without re-parsing the runs directory", async () => {
  const project = tempProject()
  const base = createDagFileStore({ project_dir: project })
  const counting = countingStore(base)
  const dag = createDagManager({ store: counting.store })
  await seedRuns(dag, parentSessionId, 4)
  // Foreign-session runs share the runs directory: the old list() parsed them too, only to discard
  // them on the parentSessionId filter, so one session's paint paid for every session's history.
  await seedRuns(dag, otherSessionId, 6)

  expect(dag.list(parentSessionId)).toHaveLength(4)
  counting.reset()

  expect(dag.list(parentSessionId)).toHaveLength(4)
  expect(counting.reads()).toBe(0)
})

test("list() re-reads only the checkpoint whose file changed and reports its new status", async () => {
  const project = tempProject()
  const base = createDagFileStore({ project_dir: project })
  const counting = countingStore(base)
  const dag = createDagManager({ store: counting.store })
  const [first, second] = await seedRuns(dag, parentSessionId, 2)
  if (first === undefined || second === undefined) throw new Error("seed failed")
  dag.list(parentSessionId)

  const record = base.readCheckpoint<DagRunRecordV1>(second)
  if (record === null) throw new Error("missing checkpoint")
  base.writeCheckpoint(second, { ...record, status: "paused", updatedAt: "2026-09-22T00:00:00.000Z" })
  counting.reset()

  const rows = dag.list(parentSessionId)
  expect(counting.reads()).toBe(1)
  expect(rows.find((row) => row.runId === second)?.status).toBe("paused")
  expect(rows.find((row) => row.runId === first)?.status).toBe("pending")
})

test("list() drops a run whose checkpoint was pruned from the directory", async () => {
  const project = tempProject()
  const base = createDagFileStore({ project_dir: project })
  const counting = countingStore(base)
  const dag = createDagManager({ store: counting.store })
  const [kept, pruned] = await seedRuns(dag, parentSessionId, 2)
  if (kept === undefined || pruned === undefined) throw new Error("seed failed")
  expect(dag.list(parentSessionId)).toHaveLength(2)

  fs.rmSync(base.paths.run(pruned))
  counting.reset()

  const rows = dag.list(parentSessionId)
  expect(rows.map((row) => row.runId)).toEqual([kept])
  expect(counting.reads()).toBe(0)
})
