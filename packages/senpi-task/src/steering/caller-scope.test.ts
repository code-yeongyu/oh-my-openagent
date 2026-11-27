import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecord, TaskRecordInput } from "../state"
import { runTaskCancel } from "../tools/control/cancel"
import type { CancelManager, CancelToolResult } from "../tools/control/types"
import { cleanupSteering, makeFakeHandle, makeHarness, type SteeringHarness } from "./__fixtures__/steering-fakes"

afterEach(cleanupSteering)

const AT = "2026-07-06T00:00:01.000Z"
const MISSING = "st_00000000"

function load(h: SteeringHarness, taskId: string): TaskRecord {
  const record = h.store.load(taskId)
  if (record === null) throw new Error(`missing record ${taskId}`)
  return record
}

function pending(h: SteeringHarness, overrides: Partial<TaskRecordInput>): TaskRecord {
  return h.seedRecord(overrides)
}

function running(h: SteeringHarness, overrides: Partial<TaskRecordInput>, childSessionId?: string): TaskRecord {
  const seeded = h.seedRecord(overrides)
  h.store.transition(seeded.task_id, {
    type: "start",
    timestamp: AT,
    ...(childSessionId === undefined ? {} : { child_session_id: childSessionId }),
  })
  h.setLive(seeded.task_id, makeFakeHandle(seeded.task_id, "in-process").handle)
  return load(h, seeded.task_id)
}

function completed(h: SteeringHarness, overrides: Partial<TaskRecordInput>): TaskRecord {
  const started = running(h, overrides)
  h.store.transition(started.task_id, { type: "complete", timestamp: AT, final_response: "done" })
  h.clearLive(started.task_id)
  return load(h, started.task_id)
}

function session(id: string): Partial<TaskRecordInput> {
  return { parent_session_id: id, root_session_id: id }
}

function manager(h: SteeringHarness): CancelManager {
  return {
    cancelTask: (idOrName, reason, options) => h.engine.cancelTask(idOrName, reason, options),
    get: (taskId) => h.store.load(taskId) ?? undefined,
  }
}

function cancel(h: SteeringHarness, caller: string | undefined, target: { task_id?: string; name?: string }) {
  return runTaskCancel(manager(h), target, caller)
}

function notFoundFor(missing: CancelToolResult, input: string): CancelToolResult {
  return JSON.parse(JSON.stringify(missing).replaceAll(MISSING, input)) as CancelToolResult
}

function untouched(record: TaskRecord) {
  return {
    status: record.status,
    residency_state: record.residency_state,
    cancel_requested: record.cancel_requested,
    updated_at: record.updated_at,
  }
}

describe("task_cancel applies the caller's scope", () => {
  test("#given another session's running and finished tasks #when cancelled by id #then each answer equals the missing-id answer and nothing changes", async () => {
    const h = makeHarness()
    const otherRunning = running(h, session("sess-B"))
    const otherDone = completed(h, session("sess-B"))
    const before = [otherRunning, otherDone].map(untouched)

    const missing = await cancel(h, "sess-A", { task_id: MISSING })
    const runningAnswer = await cancel(h, "sess-A", { task_id: otherRunning.task_id })
    const doneAnswer = await cancel(h, "sess-A", { task_id: otherDone.task_id })

    expect(missing.details.kind).toBe("not_found")
    expect(runningAnswer).toEqual(notFoundFor(missing, otherRunning.task_id))
    expect(doneAnswer).toEqual(notFoundFor(missing, otherDone.task_id))
    expect([otherRunning, otherDone].map((record) => untouched(load(h, record.task_id)))).toEqual(before)
    expect(h.destruction.calls).toEqual([])
  })

  test("#given no caller identity #when the caller's own task is cancelled #then nothing is cancelled and the answer is not found", async () => {
    const h = makeHarness()
    const own = running(h, session("sess-A"))
    const missing = await cancel(h, "sess-A", { task_id: MISSING })

    const answer = await cancel(h, undefined, { task_id: own.task_id })

    expect(answer).toEqual(notFoundFor(missing, own.task_id))
    expect(load(h, own.task_id).status).toBe("running")
    expect(h.destruction.calls).toEqual([])
  })

  test("#given two sessions each owning a task with the same name #when each cancels that name #then each reaches its own task", async () => {
    const h = makeHarness()
    const otherWorker = running(h, { ...session("sess-B"), name: "worker" })
    const ownWorker = running(h, { ...session("sess-A"), name: "worker" })

    const first = await cancel(h, "sess-A", { name: "worker" })

    expect(first.details).toMatchObject({ kind: "cancelled", task_id: ownWorker.task_id })
    expect(load(h, otherWorker.task_id).status).toBe("running")

    const second = await cancel(h, "sess-B", { name: "worker" })

    expect(second.details).toMatchObject({ kind: "cancelled", task_id: otherWorker.task_id })
  })

  test("#given a child session #when it cancels its sibling, its parent's other task, or its own task #then each reads as not found, and its own child is cancellable", async () => {
    const h = makeHarness()
    const self = running(h, session("sess-A"), "child-A")
    const sibling = running(h, session("sess-A"))
    const parentPending = pending(h, session("sess-A"))
    const grandchild = running(h, { parent_session_id: "child-A", root_session_id: "sess-A" })
    const before = [self, sibling, parentPending].map(untouched)
    const missing = await cancel(h, "child-A", { task_id: MISSING })

    for (const target of [sibling, parentPending, self]) {
      expect(await cancel(h, "child-A", { task_id: target.task_id })).toEqual(notFoundFor(missing, target.task_id))
    }
    expect([self, sibling, parentPending].map((record) => untouched(load(h, record.task_id)))).toEqual(before)

    const own = await cancel(h, "child-A", { task_id: grandchild.task_id })

    expect(own.details).toMatchObject({ kind: "cancelled", task_id: grandchild.task_id, previous_status: "running" })
  })

  test("#given the caller's own tasks #when cancelled by id and by name #then running, pending and finished answers are unchanged", async () => {
    const h = makeHarness()
    const byId = running(h, session("sess-A"))
    const byName = running(h, { ...session("sess-A"), name: "named" })
    const queued = pending(h, session("sess-A"))
    const done = completed(h, session("sess-A"))
    const nested = running(h, { parent_session_id: "child-A", root_session_id: "sess-A" })

    expect((await cancel(h, "sess-A", { task_id: byId.task_id })).details).toMatchObject({
      kind: "cancelled",
      task_id: byId.task_id,
      previous_status: "running",
      status: "cancelled",
    })
    expect((await cancel(h, "sess-A", { name: "named" })).details).toMatchObject({
      kind: "cancelled",
      task_id: byName.task_id,
    })
    expect((await cancel(h, "sess-A", { task_id: queued.task_id })).details).toMatchObject({
      kind: "cancelled",
      task_id: queued.task_id,
      previous_status: "pending",
    })
    expect((await cancel(h, "sess-A", { task_id: done.task_id })).details).toMatchObject({
      kind: "noop",
      task_id: done.task_id,
      status: "completed",
    })
    expect((await cancel(h, "sess-A", { task_id: nested.task_id })).details).toMatchObject({
      kind: "cancelled",
      task_id: nested.task_id,
    })
  })
})

describe("interruptTask applies the caller's scope", () => {
  test("#given another session's task, a missing id, and no caller #when interrupted with a caller #then each answer is the same not found and nothing changes", async () => {
    const h = makeHarness()
    const other = running(h, session("sess-B"))
    const own = running(h, session("sess-A"))

    const missing = await h.engine.interruptTask(MISSING, { caller: { sessionId: "sess-A" } })
    const otherAnswer = await h.engine.interruptTask(other.task_id, { caller: { sessionId: "sess-A" } })
    const noCaller = await h.engine.interruptTask(own.task_id, { caller: { sessionId: undefined } })

    expect(missing.kind).toBe("not_found")
    expect(otherAnswer).toEqual(JSON.parse(JSON.stringify(missing).replaceAll(MISSING, other.task_id)))
    expect(noCaller).toEqual(JSON.parse(JSON.stringify(missing).replaceAll(MISSING, own.task_id)))
    expect(load(h, other.task_id).status).toBe("running")
    expect(load(h, own.task_id).status).toBe("running")
  })

  test("#given the caller's own running task #when interrupted with that caller #then it is interrupted", async () => {
    const h = makeHarness()
    const own = running(h, session("sess-A"))

    const answer = await h.engine.interruptTask(own.task_id, { caller: { sessionId: "sess-A" } })

    expect(answer).toEqual({ kind: "interrupted", task_id: own.task_id, previous_status: "running" })
  })
})

describe("task_send looks a name up among the caller's tasks first", () => {
  test("#given two sessions each owning a task with the same name #when each sends to that name #then each reaches its own task", async () => {
    const h = makeHarness()
    const otherWorker = running(h, { ...session("sess-B"), name: "worker" })
    const ownWorker = running(h, { ...session("sess-A"), name: "worker" })

    const fromA = await h.engine.sendToTask({ idOrName: "worker", message: "hi", callerSessionId: "sess-A" })
    const fromB = await h.engine.sendToTask({ idOrName: "worker", message: "hi", callerSessionId: "sess-B" })

    expect(fromA).toMatchObject({ kind: "steered", task_id: ownWorker.task_id })
    expect(fromB).toMatchObject({ kind: "steered", task_id: otherWorker.task_id })
  })

  test("#given another session's task #when sent to by id #then the existing refusal is kept", async () => {
    const h = makeHarness()
    const other = running(h, session("sess-B"))

    const answer = await h.engine.sendToTask({ idOrName: other.task_id, message: "hi", callerSessionId: "sess-A" })

    expect(answer).toMatchObject({ kind: "scope_denied", task_id: other.task_id, owning_session_id: "sess-B" })
  })
})
