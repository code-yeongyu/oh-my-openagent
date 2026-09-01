import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { join } from "node:path"

import type { DagTaskOwner } from "../dag/owner"
import type { ManagedChildHandle } from "./child-handle"
import type { DagNodeId, DagRunId } from "../dag/types"
import { createTaskRecordStore } from "../store"
import type { TaskRecordStore } from "../store"
import { FakeRunner, baseSpec, categoryPlanner, cleanupProjects, makeManager, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type { ManagedRunner, ManagedStartSpec, SpawnAdmission } from "./types"

const owner: DagTaskOwner = {
  kind: "dag",
  runId: "run-1" as DagRunId,
  nodeId: "node-1" as DagNodeId,
  fingerprint: "fingerprint-1",
}

afterEach(cleanupProjects)

function deferred<T>() {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe("TaskManager.startOwned", () => {
  test("#given a new DAG owner #when started #then the initial claim persists the owner before launch", async () => {
    // given
    const project = tempProject()
    const inner = createTaskRecordStore({ project_dir: project })
    let claimedOwner: unknown
    const store: TaskRecordStore = {
      ...inner,
      save(record) {
        claimedOwner = record.owner
        inner.save(record)
      },
    }
    const runner = new FakeRunner()
    const manager = createTaskManager({
      store,
      runners: { "in-process": runner, process: runner },
      planner: categoryPlanner(),
      config: settings({ default_concurrency: 5, max_depth: 1 }),
      cwd: project,
    })

    // when
    const result = await manager.startOwned(baseSpec(), owner)

    // then
    expect(result.kind).toBe("started")
    if (result.kind !== "started") throw new Error("expected started")
    expect(result.reused).toBe(false)
    expect(claimedOwner).toEqual(owner)
    expect(inner.load(result.task_id)?.owner).toEqual(owner)
    expect(runner.startedSpecs).toHaveLength(1)
  })

  test("#given two overlapping starts for one owner #when creation is still awaiting launch #then the owner lock serializes the second start", async () => {
    // given
    const project = tempProject()
    const launch = deferred<ManagedChildHandle>()
    const startedSpecs: ManagedStartSpec[] = []
    const runner: ManagedRunner = {
      start(spec) {
        startedSpecs.push(spec)
        return launch.promise
      },
    }
    const firstStore = createTaskRecordStore({ project_dir: project })
    const firstManager = createTaskManager({
      store: firstStore,
      runners: { "in-process": runner, process: runner },
      planner: categoryPlanner(),
      config: settings({ default_concurrency: 5, max_depth: 1 }),
      cwd: project,
    })
    const secondManager = createTaskManager({
      store: createTaskRecordStore({ project_dir: project }),
      runners: { "in-process": runner, process: runner },
      planner: categoryPlanner(),
      config: settings({ default_concurrency: 5, max_depth: 1 }),
      cwd: project,
    })
    const first = firstManager.startOwned(baseSpec(), owner)
    while (startedSpecs.length === 0) await Promise.resolve()
    const ownerKey = `${owner.kind}\0${owner.runId}\0${owner.nodeId}`
    const lockPath = `${join(firstStore.stateDir, "owner-locks", createHash("sha256").update(ownerKey).digest("hex"))}.lock`

    // when
    const second = secondManager.startOwned(baseSpec(), owner)
    const beforeLaunch = await Promise.race([
      second.then(() => "settled" as const),
      Promise.resolve("pending" as const),
    ])

    // then
    expect(fs.existsSync(lockPath)).toBe(true)
    expect(beforeLaunch).toBe("pending")
    const startedSpec = startedSpecs[0]
    if (startedSpec === undefined) throw new Error("expected blocked launch")
    const handle = new FakeRunner().start(startedSpec)
    launch.resolve(await handle)
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.kind).toBe("started")
    expect(secondResult.kind).toBe("started")
    if (firstResult.kind !== "started" || secondResult.kind !== "started") throw new Error("expected starts")
    expect(firstResult.task_id).toBe(secondResult.task_id)
    expect(secondResult.reused).toBe(true)
    expect(startedSpecs).toHaveLength(1)
  })

  test("#given an existing owner with the same fingerprint #when started again #then it reuses one persisted task and never double-spawns", async () => {
    // given
    const { manager, store, inProcess } = makeManager()
    const first = await manager.startOwned(baseSpec(), owner)
    if (first.kind !== "started") throw new Error("expected first start")

    // when
    const second = await manager.startOwned(baseSpec(), owner)

    // then
    expect(second.kind).toBe("started")
    if (second.kind !== "started") throw new Error("expected reused start")
    expect(second.reused).toBe(true)
    expect(second.task_id).toBe(first.task_id)
    expect(store.list().records).toHaveLength(1)
    expect(inProcess.startedSpecs).toHaveLength(1)
    expect(manager.findOwnedTask(owner)?.task_id).toBe(first.task_id)
  })

  test("#given a still-running owner with a different fingerprint #when started again #then it returns owner_conflict without another task", async () => {
    // given
    const { manager, store, inProcess } = makeManager()
    const first = await manager.startOwned(baseSpec(), owner)
    if (first.kind !== "started") throw new Error("expected first start")

    // when
    const conflict = await manager.startOwned(baseSpec(), { ...owner, fingerprint: "fingerprint-2" })

    // then
    expect(conflict).toEqual({
      kind: "owner_conflict",
      task_id: first.task_id,
      existing_fingerprint: "fingerprint-1",
      requested_fingerprint: "fingerprint-2",
    })
    expect(store.list().records).toHaveLength(1)
    expect(inProcess.startedSpecs).toHaveLength(1)
  })

  test("#given a TERMINAL owner with a different fingerprint #when started again #then ownership is replaced and a fresh task runs", async () => {
    // given - a retried DAG node presents the same (kind,runId,nodeId) with an execAttempt-scoped
    // fingerprint; the settled record must release its claim instead of failing the retry.
    const { manager, store, inProcess } = makeManager()
    const first = await manager.startOwned(baseSpec(), owner)
    if (first.kind !== "started") throw new Error("expected first start")
    store.transition(first.task_id, { type: "complete", timestamp: new Date().toISOString(), final_response: "done" })

    // when
    const retried = await manager.startOwned(baseSpec(), { ...owner, fingerprint: "fingerprint-2" })

    // then
    expect(retried.kind).toBe("started")
    if (retried.kind !== "started") throw new Error("expected retried start")
    expect(retried.reused).toBe(false)
    expect(retried.task_id).not.toBe(first.task_id)
    expect(inProcess.startedSpecs).toHaveLength(2)
    expect(manager.findOwnedTask(owner)?.task_id).toBe(retried.task_id)
    expect(store.load(retried.task_id)?.owner).toEqual({ ...owner, fingerprint: "fingerprint-2" })
    // The superseded record keeps its dag kind marker so a pending spawn's launcher-stripping read
    // still sees an owned child; only the authoritative claim moves to the newer record.
    const released = store.load(first.task_id)
    expect(released?.status).toBe("completed")
    expect(released?.owner).toEqual(owner)
    expect(store.list().records).toHaveLength(2)
  })

  test("#given caller journal knowledge is lost after dispatch #when a fresh manager starts the same owner #then recovery finds exactly one task", async () => {
    // given
    const project = tempProject()
    const firstManager = makeManager({ project })
    const first = await firstManager.manager.startOwned(baseSpec(), owner)
    if (first.kind !== "started") throw new Error("expected first start")

    // when
    const recoveredManager = makeManager({ project })
    const recovered = await recoveredManager.manager.startOwned(baseSpec(), owner)

    // then
    expect(recovered.kind).toBe("started")
    if (recovered.kind !== "started") throw new Error("expected recovered start")
    expect(recovered.reused).toBe(true)
    expect(recovered.task_id).toBe(first.task_id)
    expect(recoveredManager.store.list().records).toHaveLength(1)
    expect(recoveredManager.inProcess.startedSpecs).toHaveLength(0)
  })

  test("#given depth, residency, and concurrency gates #when owned starts are attempted #then the existing manager outcomes remain authoritative", async () => {
    // given
    const depth = makeManager({ config: settings({ default_concurrency: 1, max_depth: 1 }) })
    const deniedAdmission = (): Promise<SpawnAdmission> => Promise.resolve({ kind: "rejected", message: "cap reached" })
    const residency = makeManager({ admit: deniedAdmission })
    const queued = makeManager({ config: settings({ default_concurrency: 1, max_depth: 1 }) })

    // when
    const depthResult = await depth.manager.startOwned(baseSpec({ depth: 2 }), owner)
    const residencyResult = await residency.manager.startOwned(baseSpec(), owner)
    const running = await queued.manager.startOwned(baseSpec({ name: "running" }), owner)
    const pending = await queued.manager.startOwned(
      baseSpec({ name: "pending" }),
      { ...owner, nodeId: "node-2" as DagNodeId, fingerprint: "fingerprint-2" },
    )

    // then
    expect(depthResult.kind).toBe("depth_denied")
    expect(depth.store.list().records).toHaveLength(0)
    expect(residencyResult.kind).toBe("residency_denied")
    expect(residency.store.list().records).toHaveLength(0)
    expect(running.kind).toBe("started")
    expect(pending.kind).toBe("started")
    if (pending.kind !== "started") throw new Error("expected pending start")
    expect(pending.reused).toBe(false)
    if (pending.reused) throw new Error("expected fresh pending start")
    expect(pending.status).toBe("pending")
    expect(pending.queue_position).toBe(1)
    expect(queued.store.list().records).toHaveLength(2)
  })
})
