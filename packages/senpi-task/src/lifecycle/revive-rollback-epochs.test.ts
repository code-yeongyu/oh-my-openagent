import { afterEach, describe, expect, test } from "bun:test"
import type { HandleRef } from "@code-yeongyu/senpi"

import { createEvalHandleHost } from "../eval-handles/host"
import { fenceRun, type TaskRecord } from "../state"
import { buildRevived } from "../steering/engine-policy"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import { cleanupProjects, FakeRegistry, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "./host-session"

afterEach(cleanupProjects)

const HOST_PID = 6000
const OWNER = { ownerSessionId: "parent-1" }

/** A parked task revived once by this host, then rolled back: the handle minted for that run names an undone run. */
function revivedThenRolledBack(taskId: string): { readonly store: TaskRecordStore; readonly undone: HandleRef } {
  const store = tempStore()
  const prior = seedRecord(store, { task_id: taskId, status: "completed", residency_state: "rpc_detached", execution_mode: "process", run_epoch: 0 })
  const revived: TaskRecord = { ...buildRevived(prior, new Date().toISOString()), host_pid: HOST_PID }
  store.replace(revived)
  const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, registry: new FakeRegistry(), config: settings(), hostPid: HOST_PID })
  expect(lifecycle.rollbackDetachedRevival(prior)).toBe("rolled_back")
  lifecycle.dispose?.()
  return { store, undone: { kind: "agent", id: taskId, run_epoch: revived.notification.run_epoch } }
}

function reviveAgain(store: TaskRecordStore, taskId: string): TaskRecord {
  const current = store.load(taskId)
  if (current === null) throw new Error("record vanished")
  const next = { ...buildRevived(current, new Date().toISOString()), host_pid: HOST_PID }
  store.replace(next)
  return next
}

describe("a rolled-back run's epoch is never issued again (#9562)", () => {
  test("the next revive after a rollback starts above the undone epoch, so the undone run's handle never names it", () => {
    const { store, undone } = revivedThenRolledBack("st_00009562")

    const next = reviveAgain(store, undone.id)

    expect(next.notification.run_epoch).toBeGreaterThan(undone.run_epoch)
    expect(fenceRun(next, undone.run_epoch)).toBe("superseded")
  })

  test("a send through the undone run's handle after the next revive is refused, and never reaches the newer run", async () => {
    const { store, undone } = revivedThenRolledBack("st_00009563")
    reviveAgain(store, undone.id)
    const delivered: string[] = []
    const host = createEvalHandleHost({
      tasks: {
        get: (id) => store.load(id) ?? undefined,
        waitFor: () => new Promise(() => undefined),
        cancelTask: async (id) => ({ kind: "noop", task_id: id, status: "running", reason: "unused" }),
        sendToTask: async (input) => {
          delivered.push(input.message)
          return { kind: "steered", task_id: input.idOrName, status: "running", delivered: "followUp" }
        },
      },
      workpools: { inspect: () => { throw new Error("no pools") }, cancel: () => { throw new Error("no pools") }, subscribe: () => () => undefined },
      poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
      stateDir: store.stateDir,
    })

    await expect(host.send(undone, "meant for the undone run", OWNER)).rejects.toMatchObject({ code: "eval_handle_stale" })
    expect(delivered).toEqual([])
  })

  test("the burnt epoch survives a reload of the record from disk, so a restarted host still skips it", () => {
    const { store, undone } = revivedThenRolledBack("st_00009564")

    const reloaded = createTaskRecordStore({ project_dir: "/unused", task: { state_dir: store.stateDir } }).load(undone.id)

    if (reloaded === null) throw new Error("record vanished")
    expect(buildRevived(reloaded, new Date().toISOString()).notification.run_epoch).toBeGreaterThan(undone.run_epoch)
  })

  test("a rollback that undid only a claim (no run was started) burns nothing: the next run takes the very next epoch", () => {
    const store = tempStore()
    const prior = seedRecord(store, { task_id: "st_00009565", status: "completed", residency_state: "rpc_detached", execution_mode: "process", run_epoch: 3 })
    store.replace({ ...prior, residency_state: "resident", host_pid: HOST_PID })
    const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, registry: new FakeRegistry(), config: settings(), hostPid: HOST_PID })

    expect(lifecycle.rollbackDetachedRevival(prior)).toBe("rolled_back")
    lifecycle.dispose?.()

    expect(reviveAgain(store, prior.task_id).notification.run_epoch).toBe(4)
  })
})
