import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { createWorkpoolEngine } from "./engine"
import type { WorkpoolAdmission, WorkpoolRequest } from "./ports"
import { createWorkpoolStore } from "./store"
import type { WorkpoolSpec } from "./types"
import { acknowledgeWorkerTurn, appendAssignedMessages, beginWorkerTurn } from "./worker-turn"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const nextTick = () => new Promise<void>(resolve => setImmediate(resolve))

test("design 21: Stop with two busy workers, a granted waiter and three queued items dispatches nothing; Resume continues both workers and re-enqueues in order", async () => {
  const root = mkdtempSync(join(tmpdir(), "pool-workers-"))
  roots.push(root)
  const caller = { sessionId: "parent", rootSessionId: "parent", depth: 0, cwd: root }
  const spec: WorkpoolSpec = {
    plan: { model: "test/model" },
    start: { prompt: "work", parent_session_id: "parent", root_session_id: "parent", depth: 1, cwd: root, execution_mode: "in-process" },
  }
  const tasks = createTaskRecordStore({ project_dir: root })
  const pools = createWorkpoolStore(root)
  const workers = ["one", "two"].map(() => {
    const record = { ...createTaskRecord({ parent_session_id: "parent", root_session_id: "parent", depth: 1, execution_mode: "in-process" as const, model: "test/model", notify_on_terminal: false }), status: "running" as const }
    tasks.save(record)
    return record.task_id
  })
  const requests: WorkpoolRequest[] = []
  const cancelled: string[] = []
  const admission: WorkpoolAdmission = {
    tasks, resolve: () => spec, hasFreeSlot: () => true,
    request: request => { requests.push(request); return { cancel: () => { cancelled.push(request.item.key) } } },
    drain() {}, get: taskId => tasks.load(taskId) ?? undefined, pending: () => false, cancel: async () => undefined,
    waitFor: (_taskId, signal) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("aborted"))) }),
  }
  const engine = createWorkpoolEngine(root, admission)
  try {
    const pool = engine.create(caller, { name: "work", agent: { category: "quick", prompt: "work" } })
    engine.push(caller, pool.pool_id, ["one", "two", "three", "four", "five", "six"].map(key => ({ key, input: key })))
    await nextTick()
    expect(requests.map(request => request.item.key)).toEqual(["one", "two", "three", "four", "five", "six"])
    for (const [index, taskId] of workers.entries()) {
      const request = requests[index]
      if (request === undefined || taskId === undefined) throw new Error("missing worker request")
      expect(request.bind(taskId, 0)).toBe(true)
      const turn = { pool_id: pool.pool_id, generation: pool.generation, task_id: taskId, run_epoch: 0 }
      appendAssignedMessages({ pools, tasks }, turn)
      const begun = beginWorkerTurn({ pools, tasks }, turn)
      acknowledgeWorkerTurn({ pools, tasks }, turn, begun?.entries)
      request.event({ pool_id: pool.pool_id, kind: "dispatched", item_id: request.item.item_id, task_id: taskId, run_epoch: 0 })
    }
    const granted = requests[2]
    if (granted === undefined) throw new Error("missing granted waiter")
    await nextTick()

    engine.pauseForRun(caller, pool.pool_id, 7)
    expect(granted.current()).toBe(false)
    expect(granted.bind("st_granted", 0)).toBe(false)
    expect(cancelled.toSorted()).toEqual(["five", "four", "six", "three"])
    const held = engine.inspect(caller, pool.pool_id)
    expect(held.hold).toEqual({ reason: "user_stop", pauseSeq: 7 })
    expect(held.workers.map(worker => worker.status)).toEqual(["paused", "paused"])
    expect(held.items.map(item => [item.key, item.status])).toEqual([
      ["one", "assigned"], ["two", "assigned"], ["three", "queued"], ["four", "queued"], ["five", "queued"], ["six", "queued"],
    ])
    const beforeResume = requests.length
    await nextTick()
    expect(requests).toHaveLength(beforeResume)

    expect(engine.resumeForRun(caller, pool.pool_id, 7)).toEqual({ released: true })
    await nextTick()
    const resumed = engine.inspect(caller, pool.pool_id)
    expect(resumed.workers.map(worker => worker.status)).toEqual(["busy", "busy"])
    expect(requests.slice(beforeResume).map(request => request.item.key)).toEqual(["three", "four", "five", "six"])
  } finally { engine.dispose() }
})
