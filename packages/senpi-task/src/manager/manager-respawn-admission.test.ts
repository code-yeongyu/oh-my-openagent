import { afterEach, expect, mock, test } from "bun:test"

import type { RpcChildHandle } from "../runners/types"
import type { TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { FakeRunner, cleanupProjects, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

afterEach(cleanupProjects)

test("#given current planner rejects persisted target #when task respawns #then no child starts", async () => {
  // given
  const record: TaskRecord = {
    task_id: "st_deadbeef",
    name: "reattach-me",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    agent_type: "disabled-agent",
    execution_mode: "process",
    model: "openai/gpt-5.6-sol",
    status: "lost",
    residency_state: "resident",
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const runner = new FakeRunner()
  const start = mock((): RpcChildHandle => { throw new Error("runner must not start") })
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "error", error: { code: "unknown_target", message: "target disabled" } }),
    config: settings(),
    cwd: project,
    trustedRespawnAdmission: async () => ({ callerRole: "coordinator", lineage: "known", rootSessionId: "parent-1", childDepth: 1 }),
    rpcRespawnRunner: { start },
  })

  // when
  const result = await manager.respawn(record, "parent-1", "/tmp/session.jsonl")

  // then
  expect(result).toEqual({ ok: false, reason: "current spawn target unavailable" })
  expect(start).not.toHaveBeenCalled()
})

test("#given a model-only persisted record #when task respawns #then it fails before model launch", async () => {
  const record: TaskRecord = {
    task_id: "st_deadbeef",
    name: "reattach-me",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    execution_mode: "process",
    model: "malicious/override",
    status: "lost",
    residency_state: "resident",
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const runner = new FakeRunner()
  const start = mock((): RpcChildHandle => { throw new Error("runner must not start") })
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan: { model: "safe/current" } }),
    config: settings(),
    cwd: project,
    trustedRespawnAdmission: async () => ({ callerRole: "coordinator", lineage: "known", rootSessionId: "parent-1", childDepth: 1 }),
    rpcRespawnRunner: { start },
  })

  const result = await manager.respawn(record, "parent-1", "/tmp/session.jsonl")

  expect(result).toEqual({ ok: false, reason: "current spawn target unavailable" })
  expect(start).not.toHaveBeenCalled()
})
