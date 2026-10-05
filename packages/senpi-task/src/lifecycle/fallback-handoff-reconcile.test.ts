import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { createManagerResidencyRegistry } from "../../../omo-senpi/src/components/task/residency-registry"
import { createTaskManager } from "../manager/manager"
import { FakeRunner, settings as managerSettings } from "../manager/__fixtures__/manager-fakes"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { ensuredDaemon, hostRunnerHarness, stubChannel } from "../runners/rpc-host.test-support"
import type { ResolvedModelRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { fixture, poolInput } from "../workpool/__fixtures__/admission"
import { createTaskLifecycle } from "./create"
import { hostLifecycleDeps } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"

// A runtime-fallback handoff is the span between the failed rung's close and the next rung's spawn,
// with no child of its own. A parent that dies in it must leave a task that another session revives
// onto the selected next model, and nothing else that has no pid may be revived by that rule.

const harness = hostRunnerHarness()

afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

const DEAD_OWNER = 11_001
const SWEEPER = 22_002
const PARENT = "parent-1"

function rung(name: string): ResolvedModelRecord {
  return { source: "category", provider: "test", model_id: name, display: `test/${name}` }
}

function persistFailedRung(store: TaskRecordStore, taskId: string): string {
  const directory = resolveChildSessionDir(join(store.stateDir, "children", taskId), taskId)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, "failed-rung.jsonl")
  writeFileSync(path, [
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "do the original task" }] } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "500 overloaded" } }),
  ].join("\n"))
  return path
}

function seedHandoff(store: TaskRecordStore, taskId: string, handoffEpoch = 1): void {
  seedRecord(store, {
    task_id: taskId,
    status: "running",
    execution_mode: "process",
    host_pid: DEAD_OWNER,
    run_epoch: 1,
    spawn_spec: { version: 1, cwd: "/tmp", prompt: "do the original task" },
  })
  store.mutate(taskId, (record) => ({
    ...record,
    model: "test/next",
    resolved_model: rung("next"),
    fallback_models: [],
    fallback_attempts: [rung("first"), rung("next")],
    fallback_handoff_epoch: handoffEpoch,
  }))
  persistFailedRung(store, taskId)
}

function sweeperOverDaemon(store: TaskRecordStore) {
  const channel = stubChannel(undefined)
  const runner = harness.runnerWithout({ createClient: () => channel, ensureDaemon: async () => ensuredDaemon(channel.socketPath) })
  const manager = createTaskManager({
    store,
    config: managerSettings(),
    cwd: "/tmp",
    hostPid: SWEEPER,
    runners: { process: new FakeRunner(), "in-process": new FakeRunner() },
    planner: () => ({ kind: "resolved", plan: { model: "test/next" } }),
    rpcRespawnRunner: runner,
  })
  const ports = hostLifecycleDeps({ store, hostPid: SWEEPER, isAlive: (pid) => pid === SWEEPER })
  const lifecycle = createTaskLifecycle({
    ...ports.deps,
    registry: createManagerResidencyRegistry(() => manager),
    respawn: (record, sessionPath) => manager.respawn(record, sessionPath),
    reattach: (record, handle) => manager.reattach(record, handle),
  })
  const dispose = async (taskId: string): Promise<void> => {
    await manager.getResidentHandle(taskId)?.dispose()
    manager.forget(taskId)
    manager.workpools.dispose()
    lifecycle.dispose?.()
  }
  return { channel, lifecycle, dispose }
}

describe("reconcile of a runtime-fallback handoff whose owner died", () => {
  for (const sweep of ["another session", "the resumed parent session"] as const) {
    test(`#given a dead owner between rungs #when ${sweep} reconciles #then the next model launches fresh and the handoff ends`, async () => {
      // given
      const store = tempStore()
      const taskId = sweep === "another session" ? "st_0000a001" : "st_0000a002"
      seedHandoff(store, taskId)
      const sweeper = sweeperOverDaemon(store)

      try {
        // when
        const result = await sweeper.lifecycle.reconcileOnSessionStart(sweep === "another session" ? "other-session" : PARENT)

        // then
        expect(result.outcomes).toContainEqual({ task_id: taskId, kind: "resumed", reason: "respawned and reattached" })
        expect(sweeper.channel.calls).toEqual(["open", "prompt"])
        const revived = store.load(taskId)
        expect(revived).toMatchObject({ status: "running", model: "test/next", runner_kind: "host-session" })
        expect(revived?.fallback_handoff_epoch).toBeUndefined()
      } finally {
        await sweeper.dispose(taskId)
      }
    })
  }

  test("#given a dead owner between rungs #when the fresh launch fails transiently #then the task is parked, never lost", async () => {
    // given
    const store = tempStore()
    seedHandoff(store, "st_0000a003")
    const ports = hostLifecycleDeps({
      store,
      hostPid: SWEEPER,
      isAlive: (pid) => pid === SWEEPER,
      respawn: async () => ({ ok: false, disposition: "retryable", code: "respawn_failed", reason: "rpc respawn failed" }),
    })
    const lifecycle = createTaskLifecycle(ports.deps)

    // when
    const result = await lifecycle.reconcileOnSessionStart("other-session")

    // then
    expect(result.outcomes).toContainEqual(expect.objectContaining({ task_id: "st_0000a003", kind: "deferred" }))
    expect(store.load("st_0000a003")).toMatchObject({ status: "running", residency_state: "rpc_detached" })
    lifecycle.dispose?.()
  })

  test("#given a pid-less record whose handoff marker belongs to an earlier epoch #when its dead owner is reconciled #then it is lost, not revived", async () => {
    // given
    const store = tempStore()
    seedHandoff(store, "st_0000a004", 0)
    const ports = hostLifecycleDeps({ store, hostPid: SWEEPER, isAlive: (pid) => pid === SWEEPER })
    const lifecycle = createTaskLifecycle(ports.deps)

    // when
    const result = await lifecycle.reconcileOnSessionStart("other-session")

    // then
    expect(result.outcomes).toContainEqual({ task_id: "st_0000a004", kind: "lost", reason: "no recorded pid" })
    expect(ports.respawned).toEqual([])
    lifecycle.dispose?.()
  })
})

describe("reconcile of a dead workpool worker", () => {
  test("#given a pid-less pool worker whose owner died #when another session and then its parent reconcile #then it ends lost instead of parking forever", async () => {
    // given
    const pool = fixture({ config: { default_execution_mode: "process" } })
    const created = pool.manager.workpools.create(pool.caller, poolInput)
    const dispatched = pool.manager.workpools.waitForEvent(created.pool_id, "dispatched", AbortSignal.timeout(5_000))
    pool.manager.workpools.push(pool.caller, created.pool_id, [{ key: "once", input: "non-replayable work" }])
    const event = await dispatched
    if (event.task_id === undefined) throw new Error("the pool dispatched no worker")
    const taskId = event.task_id
    pool.manager.workpools.dispose()
    pool.manager.forget(taskId)
    pool.store.mutate(taskId, (record) => ({ ...record, host_pid: DEAD_OWNER }))
    const manager = createTaskManager({
      store: pool.store,
      config: managerSettings(),
      cwd: pool.root,
      hostPid: SWEEPER,
      runners: { process: new FakeRunner(), "in-process": new FakeRunner() },
      planner: () => ({ kind: "resolved", plan: { model: "test/model" } }),
    })
    const ports = hostLifecycleDeps({ store: pool.store, hostPid: SWEEPER, isAlive: (pid) => pid === SWEEPER })
    const lifecycle = createTaskLifecycle({
      ...ports.deps,
      registry: createManagerResidencyRegistry(() => manager),
      respawn: (record, sessionPath) => manager.respawn(record, sessionPath),
      reattach: (record, handle) => manager.reattach(record, handle),
    })

    try {
      // when
      await lifecycle.reconcileOnSessionStart("other-session")
      await lifecycle.reconcileOnSessionStart(pool.caller.sessionId)

      // then
      expect(pool.store.load(taskId)?.status).toBe("lost")
    } finally {
      lifecycle.dispose?.()
      manager.workpools.dispose()
    }
  })
})
