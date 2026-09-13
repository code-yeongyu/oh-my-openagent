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
import { roots, cleanupRoots, detachedTerminal, fakeHandle, rpcHandle, portFor } from "./__fixtures__/residency"

afterEach(cleanupRoots)

describe("task_send lazy terminal RPC revival", () => {
  test("#given a detached terminal process with a transcript #when manager task_send targets it #then exactly one RPC child is respawned and the message revives the record", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-manager-"))
    roots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(store)
    const followUps: string[] = []
    let starts = 0
    const manager = createTaskManager({
      store,
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
      config: settings(),
      cwd: project,
      rpcRespawnRunner: {
        start: async (spec) => {
          starts += 1
          return rpcHandle(spec.task_id, followUps)
        },
      },
    })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings() })

    const outcome = await manager.sendToTask({ idOrName: record.task_id, message: "second pass" })

    expect(outcome.kind).toBe("revived")
    expect(starts).toBe(1)
    expect(followUps).toEqual(["second pass"])
    expect(store.load(record.task_id)?.status).toBe("running")
    expect(store.load(record.task_id)?.residency_state).toBe("resident")
    expect(store.load(record.task_id)?.terminal_at).toBeUndefined()
    lifecycle.dispose?.()
  })

  test("#given a terminal rpc_detached record with a transcript #when task_send sends a message #then one detached revival happens and the message is delivered", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-regression-"))
    roots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(store)
    const followUps: string[] = []
    const reviveReasons: string[] = []
    const handle = fakeHandle(record.task_id, followUps)
    const engine = createSteeringEngine(portFor(store, handle, reviveReasons))

    const outcome = await engine.sendToTask({ idOrName: record.task_id, message: "second pass" })

    expect(outcome.kind).toBe("revived")
    expect(followUps).toEqual(["second pass"])
    expect(reviveReasons).toEqual(["revived"])
  })

  test("#given a resident terminal record with terminal_at #when task_send revives it #then the new running record drops the old terminal anchor", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-terminal-at-"))
    roots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(store)
    store.mutate(record.task_id, (fresh) => ({ ...fresh, residency_state: "resident", host_pid: 6000 }))
    const followUps: string[] = []
    const reviveReasons: string[] = []
    const engine = createSteeringEngine(portFor(store, fakeHandle(record.task_id, followUps), reviveReasons, true))

    const outcome = await engine.sendToTask({ idOrName: record.task_id, message: "new run" })

    expect(outcome.kind).toBe("revived")
    expect(store.load(record.task_id)?.status).toBe("running")
    expect(store.load(record.task_id)?.terminal_at).toBeUndefined()
    expect(followUps).toEqual(["new run"])
  })
})
