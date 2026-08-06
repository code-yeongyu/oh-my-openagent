import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import {
  baseSpec,
  cleanupProjects,
  flush,
  makeManager,
} from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

const iso = (): string => new Date().toISOString()

describe("TaskManager outcome guards", () => {
  test("#given a running resident child #when suspension forgets its handle and the abort settles cancelled #then the record stays running+persisted_only and no waiter settles with a terminal", async () => {
    // given
    const { manager, store, inProcess } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id
    let settled: TaskRecord | undefined
    void manager.waitFor(taskId).then((record) => {
      settled = record
    })

    // when - suspension order: forget the handle, persist the record, THEN the abort settles
    manager.forget(taskId)
    store.transition(taskId, { type: "persist_only", timestamp: iso() })
    inProcess.handles.get(taskId)?.settle({ status: "cancelled" })
    await flush()

    // then
    const record = store.load(taskId)
    expect(record?.status).toBe("running")
    expect(record?.residency_state).toBe("persisted_only")
    expect(settled).toBeUndefined()
    expect(manager.waiterKeyCount()).toBe(1)
  })

  test("#given a suspended child #when the abort settles as an error outcome #then no error terminal lands on the record", async () => {
    // given
    const { manager, store, inProcess } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id
    manager.forget(taskId)
    store.transition(taskId, { type: "persist_only", timestamp: iso() })

    // when
    inProcess.handles.get(taskId)?.settle({
      status: "error",
      failure: { kind: "child-turn-failed", message: "aborted" },
    })
    await flush()

    // then
    const record = store.load(taskId)
    expect(record?.status).toBe("running")
    expect(record?.residency_state).toBe("persisted_only")
    expect(record?.error_message).toBeUndefined()
  })

  test("#given a suspended child #when a misleading success outcome settles late #then the record keeps running with no final response", async () => {
    // given
    const { manager, store, inProcess } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id
    manager.forget(taskId)
    store.transition(taskId, { type: "persist_only", timestamp: iso() })

    // when
    inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    await flush()

    // then
    const record = store.load(taskId)
    expect(record?.status).toBe("running")
    expect(record?.residency_state).toBe("persisted_only")
    expect(record?.final_response).toBeUndefined()
  })

  test("#given a running child #when its outcome settles in the gap after forget but before persist_only lands #then the record is still untouched", async () => {
    // given
    const { manager, store, inProcess } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id

    // when - the tightest abort-during-suspend race: ownership is gone, residency not yet updated
    manager.forget(taskId)
    inProcess.handles.get(taskId)?.settle({ status: "cancelled" })
    await flush()

    // then
    const record = store.load(taskId)
    expect(record?.status).toBe("running")
    expect(record?.residency_state).toBe("resident")
  })

  test("#given a record disposed while running with its handle still mapped #when the abort settles cancelled #then the late outcome terminalizes the drained record", async () => {
    // given - the old shutdown-dispose shape: residency flips to disposed, status stays running,
    // and the abort's late outcome is the contracted terminalization path (chaos inv3)
    const { manager, store, inProcess } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id
    store.transition(taskId, { type: "dispose", timestamp: iso() })

    // when
    inProcess.handles.get(taskId)?.settle({ status: "cancelled" })
    await flush()

    // then
    const record = store.load(taskId)
    expect(record?.status).toBe("cancelled")
    expect(record?.residency_state).toBe("disposed")
  })

  test("#given a running resident child #when it completes normally #then the record completes and the waiter settles with the terminal record", async () => {
    // given
    const { manager, store, inProcess } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id
    const waiter = manager.waitFor(taskId)

    // when
    inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    await flush()

    // then
    const record = await waiter
    expect(record.status).toBe("completed")
    expect(record.final_response).toBe("done")
    expect(store.load(taskId)?.status).toBe("completed")
  })
})

describe("TaskManager background intent", () => {
  test("#given a foreground child #when promoted to background #then notify_on_terminal round-trips through a store reload", async () => {
    // given
    const { manager, store, project } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id
    expect(store.load(taskId)?.notify_on_terminal).toBe(false)

    // when
    const promoted = manager.promoteToBackground(taskId)

    // then
    expect(promoted).toBe(true)
    const reloaded = createTaskRecordStore({ project_dir: project })
    expect(reloaded.load(taskId)?.notify_on_terminal).toBe(true)
    expect(manager.wasBackground(taskId)).toBe(true)
    expect(manager.promoteToBackground(taskId)).toBe(false)
  })

  test("#given a persisted background record #when a fresh manager over the same store is asked #then wasBackground reads the record alone", async () => {
    // given
    const first = makeManager({})
    const started = await first.manager.start(baseSpec({ run_in_background: true }))
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id

    // when
    const second = makeManager({ project: first.project })

    // then - the fresh manager never saw the spawn; only the persisted record can answer
    expect(second.manager.wasBackground(taskId)).toBe(true)
  })

  test("#given an unknown task id promoted in memory only #when queried #then wasBackground falls back to the in-memory set", () => {
    // given
    const { manager } = makeManager({})

    // when
    const promoted = manager.promoteToBackground("st_0000ffff")

    // then
    expect(promoted).toBe(true)
    expect(manager.wasBackground("st_0000ffff")).toBe(true)
  })
})
