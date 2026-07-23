import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import { FakeRunner, baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"
import type { ChildPlanner, ManagerStartSpec } from "./types"
import { recordSpawnedPid } from "./manager-helpers"

afterEach(cleanupProjects)

function runningRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_deadbeef",
    name: "t",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    execution_mode: "process",
    model: "omo-mock/mock-1",
    status: "running",
    residency_state: "resident",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:00.000Z",
    notification: { run_epoch: 0, notified_epoch: 0 },
    ...overrides,
  }
}

describe("recordSpawnedPid", () => {
  test("#given a running record and a real pid #when folded #then the pid is set on a copy", () => {
    // given a running process record and a real child pid
    const record = runningRecord()

    // when
    const updated = recordSpawnedPid(record, 4242)

    // then the pid is recorded and the original is not mutated
    expect(updated?.pid).toBe(4242)
    expect(record.pid).toBeUndefined()
  })

  test("#given no pid (in-process child) #when folded #then nothing changes", () => {
    // given / when / then
    expect(recordSpawnedPid(runningRecord(), undefined)).toBeUndefined()
  })

  test("#given a record that already went terminal #when folded #then it is left untouched", () => {
    // given a task that settled between start and the pid write
    const terminal = runningRecord({ status: "completed" })

    // when / then a settled task is never resurrected
    expect(recordSpawnedPid(terminal, 4242)).toBeUndefined()
  })
})

describe("TaskManager spawn-fact persistence", () => {
  test.each([
    {
      label: "agent alias",
      spec: { category: undefined, subagent_type: "legacy-agent" },
      plan: { agentType: "canonical-agent" },
      field: "agent_type" as const,
      canonical: "canonical-agent",
    },
    {
      label: "category alias",
      spec: { category: "legacy-category", subagent_type: undefined },
      plan: { category: "canonical-category" },
      field: "category" as const,
      canonical: "canonical-category",
    },
  ])("#given a planner-normalized $label #when a task starts #then admission and persistence use the canonical target", async ({ spec, plan, field, canonical }) => {
    // given
    const planner: ChildPlanner = (_spec: ManagerStartSpec) => ({
      kind: "resolved",
      plan: { model: "openai/current", ...plan },
    })
    const { manager, store } = makeManager({ planner })

    // when
    const result = await manager.start(baseSpec({
      ...spec,
      allowed_subagents: [canonical],
    }))

    // then
    expect(result.kind).toBe("started")
    if (result.kind !== "started") throw new Error("expected started")
    expect(store.load(result.task_id)?.[field]).toBe(canonical)
    expect(store.load(result.task_id)?.model).toBe("openai/current")
  })

  test("#given member launch env #when a process task starts #then the generated task id is threaded into the child env", async () => {
    // given
    const processRunner = new FakeRunner()
    const { manager } = makeManager({ process: processRunner })

    // when
    const result = await manager.start(baseSpec({
      execution_mode: "process",
      memberEnv: {
        SENPI_TASK_MEMBER: "11111111-1111-4111-8111-111111111111::alpha",
        SENPI_TASK_TEAM_CONFIG: "{}",
      },
    }))

    // then
    if (result.kind !== "started") throw new Error("expected started")
    expect(processRunner.startedSpecs[0]?.memberEnv).toEqual({
      SENPI_TASK_LINEAGE_TASK_ID: result.task_id,
      SENPI_TASK_MEMBER: "11111111-1111-4111-8111-111111111111::alpha",
      SENPI_TASK_TEAM_CONFIG: "{}",
      SENPI_TASK_MEMBER_TASK_ID: result.task_id,
    })
  })

  test("#given a process runner whose child has a pid #when a process task starts #then the persisted record carries that pid", async () => {
    // given a process runner that spawns a child reporting a real OS pid
    const processRunner = new FakeRunner()
    processRunner.childPid = 4242
    const { manager, store } = makeManager({ process: processRunner })

    // when a task is launched in process execution mode
    const result = await manager.start(baseSpec({
      execution_mode: "process",
      caller_max_depth: 1,
      allowed_subagents: ["quick"],
    }))

    // then the running record persisted the pid so status + reconciliation can see the live process
    if (result.kind !== "started") throw new Error("expected started")
    expect(processRunner.startedSpecs).toHaveLength(1)
    expect(store.load(result.task_id)?.pid).toBe(4242)
  })

  test("#given an in-process runner with no pid #when a task starts #then the record has no pid", async () => {
    // given the default in-process runner (no OS process, no pid)
    const { manager, store } = makeManager({})

    // when a task is launched in in-process execution mode
    const result = await manager.start(baseSpec({ execution_mode: "in-process" }))

    // then the record carries no pid (the in-process path is unchanged)
    if (result.kind !== "started") throw new Error("expected started")
    expect(store.load(result.task_id)?.pid).toBeUndefined()
  })
})
