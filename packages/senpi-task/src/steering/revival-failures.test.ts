import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { createTaskRecordStore } from "../store"
import { createSteeringEngine } from "./engine"
import { FakeRunner } from "../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../manager/manager"
import { createTaskLifecycle } from "../lifecycle/create"
import { FakeRegistry, settings } from "../lifecycle/__fixtures__/lifecycle-fakes"
import type { TaskRecord } from "../state"
import type { ManagedChildHandle } from "../manager/child-handle"
import type { SteeringPort } from "./types"
import { roots, cleanupRoots, detachedTerminal, fakeHandle, rpcHandle, portFor, storeLoad } from "./__fixtures__/residency"

afterEach(cleanupRoots)

describe("task_send lazy terminal RPC revival", () => {
  test("#given the detached terminal RPC respawn fails #when manager task_send targets it #then it returns not-continuable and rolls back to detached", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-manager-failure-"))
    roots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(store)
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings() })
    const manager = createTaskManager({
      store,
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
      config: settings(),
      cwd: project,
      rpcRespawnRunner: { start: async () => { throw new Error("respawn unavailable") } },
    })

    const outcome = await manager.sendToTask({ idOrName: record.task_id, message: "retry" })

    expect(outcome.kind).toBe("not_continuable")
    if (outcome.kind === "not_continuable") expect(outcome.reason).toContain("could not be revived")
    expect(store.load(record.task_id)?.residency_state).toBe("rpc_detached")
    expect(store.load(record.task_id)?.host_pid).toBeUndefined()
    lifecycle.dispose?.()
  })

  test("#given detached terminal revival fails #when task_send sends a message #then it returns not-continuable and leaves the record detached", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-failure-"))
    roots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(store)
    const reviveReasons: string[] = []
    const engine = createSteeringEngine(portFor(store, undefined, reviveReasons))

    const outcome = await engine.sendToTask({ idOrName: record.task_id, message: "retry" })

    expect(outcome.kind).toBe("not_continuable")
    if (outcome.kind === "not_continuable") expect(outcome.reason).toContain("respawn failed")
    expect(store.load(record.task_id)?.residency_state).toBe("rpc_detached")
    expect(reviveReasons).toEqual(["respawn failed"])
  })

  test("#given a detached terminal process at concurrency capacity #when task_send revives it #then capacity is deferred before respawn", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-capacity-"))
    roots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(store)
    const processRunner = new FakeRunner()
    let respawns = 0
    const manager = createTaskManager({
      store,
      runners: { "in-process": new FakeRunner(), process: processRunner },
      planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
      config: settings({ default_concurrency: 1, global_concurrency: 1 }),
      cwd: project,
      rpcRespawnRunner: {
        start: async () => {
          respawns += 1
          return rpcHandle(record.task_id, [])
        },
      },
    })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ default_concurrency: 1, global_concurrency: 1 }) })
    const holder = await manager.start({ prompt: "hold", parent_session_id: "parent", depth: 1 })
    if (holder.kind !== "started") throw new Error("expected holder")

    const outcome = await manager.sendToTask({ idOrName: record.task_id, message: "retry" })

    expect(outcome).toMatchObject({ kind: "admission_refused", reason: "lane_capacity" })
    expect(respawns).toBe(0)
    expect(manager.getResidentHandle(record.task_id)).toBeUndefined()
    expect(store.load(record.task_id)?.residency_state).toBe("rpc_detached")
    lifecycle.dispose?.()
  })

  test("#given a revived child whose followUp rejects while alive #when task_send delivers #then it destroys, restores terminal status, and remains lazily revivable", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-followup-failure-"))
    roots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(store)
    let live = false
    let attempts = 0
    const handle: ManagedChildHandle = {
      ...fakeHandle(record.task_id, []),
      hasExited: () => false,
      followUp: async () => {
        attempts += 1
        if (attempts === 1) throw new Error("delivery refused")
      },
    }
    const registry = new FakeRegistry()
    registry.add({
      task_id: record.task_id,
      kind: "rpc",
      pid: 7000,
      abort: async () => undefined,
      terminate: async () => undefined,
      dispose: async () => { live = false },
    })
    const lifecycle = createTaskLifecycle({ store, registry, config: settings(), hostPid: 6000 })
    const port: SteeringPort = {
      store,
      liveHandle: () => (live ? handle : undefined),
      reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
      reviveDetached: async () => {
        live = true
        store.mutate(record.task_id, (fresh) => ({ ...fresh, residency_state: "resident", host_pid: 6000 }))
        return { ok: true }
      },
      dequeuePending: () => false,
      destruction: lifecycle,
      runStatsSnapshot: () => undefined,
      now: () => Date.parse("2026-09-02T00:00:00.000Z"),
    }
    const engine = createSteeringEngine(port)

    const failed = await engine.sendToTask({ idOrName: record.task_id, message: "retry" })
    const restored = store.load(record.task_id)

    expect(failed.kind).toBe("not_continuable")
    expect(attempts).toBe(1)
    expect(live).toBe(false)
    expect(restored).toMatchObject({
      status: "completed",
      residency_state: "rpc_detached",
      final_response: "first pass",
      terminal_at: "2026-09-01T00:00:00.000Z",
      notification: { run_epoch: record.notification.run_epoch },
    })
    expect(restored?.host_pid).toBeUndefined()

    const retried = await engine.sendToTask({ idOrName: record.task_id, message: "retry" })

    expect(retried.kind).toBe("revived")
    expect(attempts).toBe(2)
    expect(store.load(record.task_id)?.status).toBe("running")
    lifecycle.dispose?.()
  })

  test("#given persistence of the revived running record throws #when task_send delivers #then it rolls back before delivery", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-persistence-failure-"))
    roots.push(project)
    const baseStore = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(baseStore)
    const followUps: string[] = []
    let live = false
    let destroyed = 0
    const handle = fakeHandle(record.task_id, followUps)
    const failingStore = {
      ...baseStore,
      mutate: (taskId: string, update: (fresh: TaskRecord) => TaskRecord) => baseStore.mutate(taskId, (fresh) => {
        const next = update(fresh)
        if (next.status === "running") throw new Error("persistence failed")
        return next
      }),
    }
    const port: SteeringPort = {
      store: failingStore,
      liveHandle: () => (live ? handle : undefined),
      reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
      reviveDetached: async () => {
        live = true
        baseStore.mutate(record.task_id, (fresh) => ({ ...fresh, residency_state: "resident", host_pid: 6000 }))
        return { ok: true }
      },
      dequeuePending: () => false,
      destruction: {
        destroyResidentTask: async (taskId) => {
          destroyed += 1
          live = false
          baseStore.mutate(taskId, (fresh) => {
            const { host_pid: _hostPid, ...rest } = fresh
            return { ...rest, residency_state: "rpc_detached" }
          })
        },
      },
      runStatsSnapshot: () => undefined,
      now: () => Date.parse("2026-09-02T00:00:00.000Z"),
    }

    const outcome = await createSteeringEngine(port).sendToTask({ idOrName: record.task_id, message: "retry" })

    expect(outcome.kind).toBe("not_continuable")
    expect(destroyed).toBe(1)
    expect(followUps).toEqual([])
    expect(storeLoad(baseStore, record.task_id)?.residency_state).toBe("rpc_detached")
  })
})
