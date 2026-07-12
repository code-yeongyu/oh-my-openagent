import { afterEach, describe, expect, test } from "bun:test"

import type { RpcChildHandle } from "../runners/types"
import type { TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { FakeRunner, categoryPlanner, cleanupProjects, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

afterEach(cleanupProjects)

function respawnRecord(): TaskRecord {
  return {
    task_id: "st_deadbeef",
    name: "reattach-me",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    execution_mode: "process",
    model: "openai/gpt-5.6",
    status: "lost",
    residency_state: "resident",
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    spawn_spec: { cwd: "/tmp/project" },
  }
}

const cleanupStages: string[] = ["terminate", "dispose"]

describe.each(cleanupStages)("TaskManager respawn %s cleanup", (cleanupStage) => {
  test("#given cancelled respawn cleanup rejects #when respawn returns #then teardown failure is surfaced", async () => {
    // given
    const record = respawnRecord()
    const cleanupFailure = new Error(`${cleanupStage} rejected`)
    let disposeCalls = 0
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
      dispose: () => {
        disposeCalls += 1
        return cleanupStage === "dispose" ? Promise.reject(cleanupFailure) : Promise.resolve()
      },
      terminate: () => cleanupStage === "terminate" ? Promise.reject(cleanupFailure) : Promise.resolve(),
      exitOutcome: () => undefined,
      waitForExit: () => Promise.resolve({
        kind: "clean" as const,
        facts: { pid: 4321, code: 0, signal: null, stderrTail: "" },
      }),
      lastSeen: () => undefined,
      switchSession: () => Promise.resolve({ cancelled: true }),
    } satisfies RpcChildHandle
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const runner = new FakeRunner()
    const manager = createTaskManager({
      store,
      runners: { "in-process": runner, process: runner },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
      rpcRespawnRunner: { start: () => handle },
    })

    // when
    const result = await manager.respawn(record, "/tmp/session.jsonl")

    // then
    expect(result).toEqual({ ok: false, reason: "rpc respawn cleanup failed" })
    expect(disposeCalls).toBe(1)
  })
})
