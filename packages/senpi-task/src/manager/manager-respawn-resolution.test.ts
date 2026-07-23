import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"

import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import type { TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { FakeRunner, cleanupProjects, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

afterEach(cleanupProjects)

test("#given respawn resolves model B #when reattached #then durable and live bookkeeping use B", async () => {
  // given
  const record: TaskRecord = {
    task_id: "st_deadbeef",
    name: "reattach-me",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    category: "quick",
    execution_mode: "process",
    model: "provider-a/model-a",
    resolved_model: { source: "category", provider: "provider-a", model_id: "model-a", display: "provider-a/model-a" },
    status: "lost",
    residency_state: "resident",
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  store.save(record)
  const handle = {
    task_id: record.task_id,
    sessionId: "respawned-session",
    pid: 4321,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForIdle: () => Promise.resolve(),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
    terminate: () => Promise.resolve(),
    exitOutcome: () => undefined,
    waitForExit: () => Promise.resolve({ kind: "clean" as const, facts: { pid: 4321, code: 0, signal: null, stderrTail: "" } }),
    lastSeen: () => undefined,
    switchSession: () => Promise.resolve({ cancelled: false }),
  } satisfies RpcChildHandle
  const started: RpcRunnerSpec[] = []
  const manager = createTaskManager({
    store,
    runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
    planner: () => ({ kind: "resolved", plan: { model: "provider-b/model-b", resolved_model: { source: "category", provider: "provider-b", model_id: "model-b", display: "provider-b/model-b" }, category: "quick" } }),
    config: settings(),
    cwd: project,
    trustedRespawnAdmission: async () => ({ callerRole: "coordinator", lineage: "known", rootSessionId: "parent-1", childDepth: 1 } as const),
    rpcRespawnRunner: { start: (spec) => { started.push(spec); return handle } },
  })

  // when
  const respawned = await manager.respawn(record, "parent-1", join(project, "session.jsonl"))
  if (!respawned.ok) throw new Error("expected respawn")
  await manager.reattach(record, respawned.handle)

  // then
  expect(started[0]?.model).toBe("provider-b/model-b")
  expect(store.load(record.task_id)?.model).toBe("provider-b/model-b")
  expect(manager.get(record.task_id)?.resolved_model?.model_id).toBe("model-b")
})

test("#given respawn resolves B #when outcome tracking throws synchronously #then only B slot releases", async () => {
  // given
  const modelA = "provider-a/model-a"
  const modelB = "provider-b/model-b"
  const record: TaskRecord = {
    task_id: "st_deadbeef",
    name: "reattach-me",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    category: "quick",
    execution_mode: "process",
    model: modelA,
    status: "lost",
    residency_state: "resident",
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  store.save(record)
  const runner = new FakeRunner()
  const respawnHandle = {
    task_id: record.task_id,
    sessionId: "respawned-session",
    pid: 4321,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForIdle: () => Promise.resolve(),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
    terminate: () => Promise.resolve(),
    exitOutcome: () => undefined,
    waitForExit: () => Promise.resolve({ kind: "clean" as const, facts: { pid: 4321, code: 0, signal: null, stderrTail: "" } }),
    lastSeen: () => undefined,
    switchSession: () => Promise.resolve({ cancelled: false }),
  } satisfies RpcChildHandle
  const failingHandle: ManagedChildHandle = {
    task_id: record.task_id,
    sessionId: "respawned-session",
    pid: 4321,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForOutcome: () => { throw new Error("outcome unavailable") },
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  }
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: (spec) => ({ kind: "resolved", plan: { model: spec.model ?? modelB, category: "quick" } }),
    config: settings({ model_concurrency: { [modelA]: 1, [modelB]: 1 } }),
    cwd: project,
    trustedRespawnAdmission: async () => ({ callerRole: "coordinator", lineage: "known", rootSessionId: "parent-1", childDepth: 1 } as const),
    rpcRespawnRunner: { start: () => respawnHandle },
  })
  await manager.start({ prompt: "hold A", parent_session_id: "parent-1", depth: 1, category: "quick", model: modelA, caller_role: "coordinator", lineage: "known" })
  const respawned = await manager.respawn(record, "parent-1", join(project, "session.jsonl"))
  if (!respawned.ok) throw new Error("expected respawn")

  // when
  const reattached = await manager.reattach(record, failingHandle)
  const nextB = await manager.start({ prompt: "run B", parent_session_id: "parent-1", depth: 1, category: "quick", model: modelB, caller_role: "coordinator", lineage: "known" })
  const nextA = await manager.start({ prompt: "wait A", parent_session_id: "parent-1", depth: 1, category: "quick", model: modelA, caller_role: "coordinator", lineage: "known" })

  // then
  if (nextB.kind !== "started" || nextA.kind !== "started") throw new Error("expected queued starts")
  expect(reattached).toEqual({ ok: false, kind: "failed", reason: "manager reattach failed" })
  expect(store.load(record.task_id)?.model).toBe(modelB)
  expect(nextB.status).toBe("running")
  expect(nextA.status).toBe("pending")
})
