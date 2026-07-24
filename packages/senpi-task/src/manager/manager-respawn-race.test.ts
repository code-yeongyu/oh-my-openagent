import { afterEach, expect, test } from "bun:test"

import type { RpcChildHandle } from "../runners/types"
import type { TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { FakeRunner, categoryPlanner, cleanupProjects, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

afterEach(cleanupProjects)

function rpcHandle(taskId: string, pid: number, switchCancelled: boolean): RpcChildHandle {
  return {
    task_id: taskId,
    sessionId: `session-${pid}`,
    pid,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForIdle: () => switchCancelled ? Promise.resolve() : new Promise(() => undefined),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
    terminate: () => Promise.resolve(),
    exitOutcome: () => undefined,
    waitForExit: () => new Promise(() => undefined),
    lastSeen: () => undefined,
    switchSession: () => Promise.resolve({ cancelled: switchCancelled }),
  }
}

test("#given peer attached a live respawn #when later overlapping respawn is cancelled #then rollback preserves live pid", async () => {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const record: TaskRecord = {
    task_id: "st_deadbeef",
    name: "reattach-me",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    category: "quick",
    execution_mode: "process",
    model: "openai/gpt-5.6",
    pid: 1234,
    status: "lost",
    residency_state: "resident",
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
  store.save(record)
  const handles = [rpcHandle(record.task_id, 5678, false), rpcHandle(record.task_id, 4321, true)]
  const runner = new FakeRunner()
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: categoryPlanner(),
    config: settings(),
    cwd: project,
    trustedRespawnAdmission: async () => ({ callerRole: "coordinator", lineage: "known", rootSessionId: "parent-1", childDepth: 1 } as const),
    rpcRespawnRunner: { start: () => {
      const handle = handles.shift()
      if (handle === undefined) throw new Error("unexpected respawn")
      return handle
    } },
  })

  const peer = await manager.respawn(record, "parent-1", `${project}/session.jsonl`)
  if (!peer.ok) throw new Error("expected peer respawn")
  expect(await manager.reattach(record, peer.handle)).toEqual({ ok: true })

  const failed = await manager.respawn(record, "parent-1", `${project}/session.jsonl`)

  expect(failed).toEqual({ ok: false, reason: "switch_session was cancelled" })
  expect(manager.getResidentHandle(record.task_id)?.pid).toBe(5678)
  expect(store.load(record.task_id)).toMatchObject({ pid: 5678, status: "running", residency_state: "resident" })
})
