import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import type { ListScope, ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"
import { createDagManager, type DagRunRecordV1 } from "./manager"
import { controlJournal } from "./node-control-context"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagRecovery } from "./recovery"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagRunId } from "./types"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "dag-recovery-scope-"))
  roots.push(root)
  return createDagFileStore({ project_dir: root }, { fsync: false })
}

async function seed(store: DagFileStore, owner: string, holder?: number) {
  const manager = createDagManager({ store })
  const started = await manager.start({
    parentSessionId: owner,
    rootSessionId: owner,
    definition: { key: owner, name: owner, nodes: [{ id: "work", prompt: "synthetic", category: "quick" }] },
  })
  const runId = started.snapshot.runId
  store.writeCheckpoint(runId, {
    ...manager.record(runId, owner),
    status: "paused",
    ...(holder === undefined ? {} : { previousLeaseHolderPid: holder }),
  })
  store.writeResult(runId, "sentinel", "unchanged result")
  return runId
}

function bytes(store: DagFileStore, runId: DagRunId) {
  return Object.fromEntries(
    fs
      .readdirSync(store.stateDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => path.includes(runId) && !path.startsWith(store.paths.locks))
      .sort()
      .map((path) => [relative(store.stateDir, path), fs.readFileSync(path).toString("base64")]),
  )
}

class SettledTasks implements TaskManager {
  readonly starts: ManagerStartSpec[] = []
  readonly tasks = new Map<string, TaskRecord>()
  readonly touches: string[] = []
  async startOwned(spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    this.starts.push(spec)
    const task_id = `task-${owner.runId}`
    const record: TaskRecord = {
      task_id,
      owner,
      name: "work",
      parent_session_id: spec.parent_session_id,
      root_session_id: spec.root_session_id ?? spec.parent_session_id,
      depth: 1,
      category: "quick",
      execution_mode: "in-process",
      model: "synthetic",
      status: "completed",
      residency_state: "resident",
      host_pid: 101,
      notify_on_terminal: false,
      created_at: "2026-09-06T00:00:00.000Z",
      updated_at: "2026-09-06T00:00:00.000Z",
      final_response: "completed",
      notification: { run_epoch: 1, notified_epoch: 0 },
    }
    this.tasks.set(task_id, record)
    return { kind: "started", reused: false, task_id, status: "running", name: "work" }
  }
  get(id: string) {
    this.touches.push(id)
    return this.tasks.get(id)
  }
  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">) {
    this.touches.push(owner.runId)
    return [...this.tasks.values()].find(
      (task) => task.owner?.runId === owner.runId && task.owner.nodeId === owner.nodeId,
    )
  }
  async waitFor(id: string) {
    this.touches.push(id)
    const task = this.tasks.get(id)
    if (task === undefined) throw new Error("missing synthetic task")
    return task
  }
  start(): Promise<never> {
    throw new Error("unexpected start")
  }
  continueTask(): Promise<never> {
    throw new Error("unexpected continue")
  }
  sendToTask(): Promise<never> {
    throw new Error("unexpected send")
  }
  interruptTask(): Promise<never> {
    throw new Error("unexpected interrupt")
  }
  cancelTask(): Promise<never> {
    throw new Error("unexpected cancel")
  }
  list(scope: ListScope) {
    return [...this.tasks.values()]
      .filter((record) => scope.scope === "all" || record.parent_session_id === scope.session_id)
      .map((record) => ({ record }))
  }
  forget(_taskId: string, _options: Parameters<TaskManager["forget"]>[1]): void {
    throw new Error("unexpected forget")
  }
  getResidentHandle(): undefined {
    return undefined
  }
  subscribeChild(id: string): () => void {
    this.touches.push(id)
    return () => undefined
  }
  residentTaskIds(): readonly string[] {
    return []
  }
  residencyChanged(): Promise<void> {
    return new Promise<void>(() => undefined)
  }
  promoteToBackground(): boolean {
    return false
  }
  wasBackground(): boolean {
    return true
  }
}

function recovery(store: DagFileStore, taskManager = new SettledTasks()) {
  return createDagRecovery({ store, taskManager, hostPid: 101, isProcessAlive: (pid) => pid === 101 || pid === 202 })
}

describe("automatic recovery candidate scope", () => {
  test("#given the old holder changes while checking liveness #when recovery claims #then it preserves the workspace journal and declines the new live lease", async () => {
    // given
    const store = fixture()
    const runId = await seed(store, "A", 9001)
    const initialRecord = store.readCheckpoint<DagRunRecordV1>(runId)
    if (initialRecord === null) throw new Error("missing initial checkpoint")
    const peer = createDagFileStore(
      { project_dir: store.stateDir, task: { state_dir: store.stateDir } },
      { fsync: false },
    )
    const taskManager = new SettledTasks()
    const checked: number[] = []
    const journal = controlJournal({ store: peer, taskManager, initialRecord }, initialRecord)

    // when
    const outcomes = await createDagRecovery({
      store,
      taskManager,
      hostPid: 101,
      isProcessAlive(pid) {
        checked.push(pid)
        if (pid !== 9001) return pid === 202
        peer.withJournalLock(runId, () => {
          journal.append({
            type: "dag.diagnostic.added",
            diagnostic: {
              kind: "node_flag",
              nodeId: initialRecord.nodes[0]!.id,
              message: "peer checkpoint update",
              at: initialRecord.createdAt,
            },
          })
          peer.writeCheckpoint(runId, { ...journal.snapshot(), leaseHolderPid: 202 })
        })
        return false
      },
    }).resumePausedRuns("A")

    // then
    expect(checked).toEqual([9001, 202])
    expect(outcomes).toEqual([{ kind: "skipped", runId, reason: "live_lease", holderPid: 202 }])
    expect(taskManager.starts).toEqual([])
    expect(store.readCheckpoint<DagRunRecordV1>(runId)).toMatchObject({
      checkpointSeq: initialRecord.checkpointSeq + 1,
      leaseHolderPid: 202,
    })
    expect(store.readEvents(runId, initialRecord.checkpointSeq, { limit: 10 }).events).toHaveLength(1)
  })

  test.each([9001, 101, 202, undefined])(
    "#given foreign holder %s #when ordinary B opens #then only B executes and A bytes/tasks stay untouched",
    async (holder) => {
      const store = fixture()
      const foreign = await seed(store, "A", holder)
      const own = await seed(store, "B", 9001)
      const before = bytes(store, foreign)
      const tasks = new SettledTasks()
      const locks: DagRunId[] = []
      const observedStore: DagFileStore = {
        ...store,
        withAsyncJournalLock(id, action) {
          locks.push(id)
          return store.withAsyncJournalLock(id, action)
        },
      }
      const outcomes = await recovery(observedStore, tasks).resumePausedRuns("B")
      expect(store.readCheckpoint<DagRunRecordV1>(foreign)?.parentSessionId).toBe("A")
      expect(bytes(store, foreign)).toEqual(before)
      expect(outcomes.map((outcome) => [outcome.runId, outcome.kind])).toEqual([[own, "resumed"]])
      expect(store.readCheckpoint<DagRunRecordV1>(own)?.status).toBe("completed")
      expect(tasks.starts.map((spec) => spec.parent_session_id)).toEqual(["B"])
      expect(tasks.touches.some((id) => id.includes(foreign))).toBe(false)
      expect(locks).not.toContain(foreign)
    },
  )

  test.each([9001, 101, 202, undefined])(
    "#given immediate source holder %s #when C forks from A #then only eligible A and own C recover",
    async (holder) => {
      const store = fixture()
      const source = await seed(store, "A", holder)
      const sibling = await seed(store, "B", 9001)
      const own = await seed(store, "C", 9001)
      const siblingBefore = bytes(store, sibling)
      const sourceBefore = bytes(store, source)
      const outcomes = await recovery(store).resumePausedRuns("C", "A")
      const eligible = holder === 9001 || holder === 101
      expect(outcomes.map((outcome) => outcome.runId).sort()).toEqual((eligible ? [source, own] : [own]).sort())
      expect(bytes(store, sibling)).toEqual(siblingBefore)
      if (eligible) {
        expect(store.readCheckpoint<DagRunRecordV1>(source)?.parentSessionId).toBe("C")
        expect(outcomes.find((outcome) => outcome.runId === source)?.kind).toBe("adopted")
      } else expect(bytes(store, source)).toEqual(sourceBefore)
    },
  )

  test.each(["A", "C"])(
    "#given observed owner %s changes under the claim lock #when C forks #then the new foreign owner is not claimed",
    async (owner) => {
      const store = fixture()
      const runId = await seed(store, owner, 9001)
      let changed = false
      let afterRace: ReturnType<typeof bytes> | undefined
      const racingStore: DagFileStore = {
        ...store,
        withAsyncJournalLock(id, action) {
          return store.withAsyncJournalLock(id, () => {
            if (!changed && id === runId) {
              const record = store.readCheckpoint<DagRunRecordV1>(id)
              if (record === null) throw new Error("missing race fixture")
              store.writeCheckpoint(id, { ...record, parentSessionId: "B", rootSessionId: "B" })
              afterRace = bytes(store, id)
              changed = true
            }
            return action()
          })
        },
      }
      const tasks = new SettledTasks()
      expect(await recovery(racingStore, tasks).resumePausedRuns("C", "A")).toEqual([])
      expect(changed).toBe(true)
      if (afterRace === undefined) throw new Error("owner race did not run")
      expect(bytes(store, runId)).toEqual(afterRace)
      expect(tasks.starts).toEqual([])
    },
  )

  test("#given a completed fork attach #when the same recovery object later reopens C #then source authorization is gone", async () => {
    const store = fixture()
    const recovering = recovery(store)
    await recovering.resumePausedRuns("C", "A")
    const leftover = await seed(store, "A", 9001)
    const before = bytes(store, leftover)
    expect(await recovering.resumePausedRuns("C")).toEqual([])
    expect(bytes(store, leftover)).toEqual(before)
  })

  test.each(["", "  "])(
    "#given a blank fork source %p and a legacy record with a blank owner #when C forks #then nothing is claimed or touched",
    async (source) => {
      const store = fixture()
      const legacy = await seed(store, "A", 9001)
      const record = store.readCheckpoint<DagRunRecordV1>(legacy)
      if (record === null) throw new Error("missing legacy fixture")
      store.writeCheckpoint(legacy, { ...record, parentSessionId: "", rootSessionId: "" })
      const before = bytes(store, legacy)
      const tasks = new SettledTasks()
      expect(await recovery(store, tasks).resumePausedRuns("C", source)).toEqual([])
      expect(bytes(store, legacy)).toEqual(before)
      expect(tasks.starts).toEqual([])
      expect(tasks.touches).toEqual([])
    },
  )
})
