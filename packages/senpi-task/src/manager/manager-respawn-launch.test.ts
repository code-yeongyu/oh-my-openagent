import { afterEach, describe, expect, test } from "bun:test"

import type { RpcChildHandle } from "../runners/types"
import { createTaskRecord, type TaskRecord } from "../state"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import { categoryPlanner, cleanupProjects, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

const startedAt = "2026-09-08T01:00:00.000Z"
const priorStartedAt = "2026-09-07T01:00:00.000Z"
const hostPid = 7001

afterEach(cleanupProjects)

function harness(mode: "in-process" | "process", priorStamp?: string) {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const record: TaskRecord = {
    ...createTaskRecord({
      parent_session_id: "parent-launch", root_session_id: "parent-launch", depth: 1,
      execution_mode: mode, model: "fake-model", notify_on_terminal: false,
    }, Date.parse("2026-09-07T00:00:00.000Z")),
    host_pid: hostPid,
    spawn_spec: { version: 1, cwd: project, prompt: "resume pending work" },
    ...(priorStamp === undefined ? {} : { started_at: priorStamp }),
  }
  store.save(record)
  const observations: Array<TaskRecord | null> = []
  const handle = makeHandle(record.task_id).handle
  const observe = () => observations.push(createTaskRecordStore({ project_dir: project }).load(record.task_id))
  const runner = {
    start: async () => { observe(); return handle },
    resume: async () => { observe(); return handle },
  }
  const rpcHandle: RpcChildHandle = {
    ...handle,
    pid: 4321,
    subscribe: () => () => undefined,
    waitForIdle: async () => undefined,
    terminate: async () => undefined,
    exitOutcome: () => undefined,
    waitForExit: async () => ({ kind: "clean", facts: { pid: 4321, code: 0, signal: null, stderrTail: "" } }),
    lastSeen: () => undefined,
    switchSession: async () => ({ cancelled: false }),
  }
  const options = {
    store,
    runners: { "in-process": runner, process: runner },
    rpcRespawnRunner: { start: async () => { observe(); return rpcHandle } },
    planner: categoryPlanner(), config: settings(), cwd: project, hostPid,
    now: () => Date.parse(startedAt),
  }
  return { store, record, observations, handle, options, project }
}

describe.each(["in-process", "process"] as const)("%s respawn durable launch boundary", (mode) => {
  for (const sessionPath of [undefined, "/tmp/respawn-launch-session.jsonl"]) {
    test.each([undefined, priorStartedAt])(`#given a pending record with stamp %s and ${sessionPath === undefined ? "no transcript" : "a resume path"} #when respawn invokes its runner #then launch evidence is already durable and preserved`, async (priorStamp) => {
      // given
      const fixture = harness(mode, priorStamp)
      const manager = createTaskManager(fixture.options)
      const expectedStamp = priorStamp ?? startedAt

      // when
      const result = await manager.respawn(fixture.record, sessionPath)

      // then - an independent store reads the disk at the first runner invocation.
      expect(result.ok).toBe(true)
      expect(fixture.observations).toHaveLength(1)
      expect(fixture.observations[0]).toMatchObject({ started_at: expectedStamp, status: "pending" })
      expect(createTaskRecordStore({ project_dir: fixture.project }).load(fixture.record.task_id)?.started_at).toBe(expectedStamp)
    })
  }

  test.each(["missing", "write-failed"] as const)("#given a %s record at the launch boundary #when respawn cannot persist evidence #then no runner is invoked", async (failure) => {
    // given
    const fixture = harness(mode)
    if (failure === "missing") fixture.store.remove(fixture.record.task_id)
    const store: TaskRecordStore = failure === "missing" ? fixture.store : {
      ...fixture.store,
      mutate: () => { throw new Error("injected launch stamp write failure") },
    }
    const manager = createTaskManager({ ...fixture.options, store })

    // when
    const result = await manager.respawn(fixture.record)

    // then
    expect(result).toMatchObject({ ok: false, disposition: "retryable", code: "respawn_failed" })
    expect(fixture.observations).toEqual([])
  })
})

describe("reattach durable launch boundary", () => {
  test.each([undefined, priorStartedAt])("#given a claimed pending record with stamp %s #when reattached #then running and launch evidence persist without resetting an existing stamp", async (priorStamp) => {
    // given
    const fixture = harness("in-process", priorStamp)
    const manager = createTaskManager(fixture.options)

    // when
    const result = await manager.reattach(fixture.record, fixture.handle)

    // then
    expect(result).toEqual({ ok: true })
    expect(createTaskRecordStore({ project_dir: fixture.project }).load(fixture.record.task_id)).toMatchObject({
      status: "running", started_at: priorStamp ?? startedAt, updated_at: startedAt,
      notification: { run_epoch: fixture.record.notification.run_epoch + 1 },
    })
  })
})
