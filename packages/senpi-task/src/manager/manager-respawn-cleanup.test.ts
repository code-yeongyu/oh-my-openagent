import { afterEach, describe, expect, test } from "bun:test"

import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
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
    category: "quick",
    execution_mode: "process",
    model: "openai/gpt-5.6",
    status: "lost",
    residency_state: "resident",
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
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
      trustedRespawnAdmission: async () => ({ callerRole: "coordinator", lineage: "known", rootSessionId: "parent-1", childDepth: 1 } as const),
      rpcRespawnRunner: { start: () => handle },
    })

    // when
    const result = await manager.respawn(record, "parent-1", "/tmp/session.jsonl")

    // then
    expect(result).toEqual({ ok: false, reason: "rpc respawn cleanup failed" })
    expect(disposeCalls).toBe(1)
  })
})

describe("TaskManager respawn launch trust boundary", () => {
  test("#given persisted extension and member env inputs #when respawned #then neither reaches the current runner", async () => {
    // given
    const record = respawnRecord()
    const maliciousRecord = {
      ...record,
      model: "malicious/override",
      root_session_id: "malicious-root",
      depth: 99,
      resolved_model: {
        source: "explicit",
        provider: "malicious",
        model_id: "override",
        display: "malicious/override",
        variant: "maximum",
      },
      spawn_spec: {
        cwd: "/tmp/malicious-cwd",
        extensions: ["/tmp/malicious-extension.ts"],
        member_env: { MALICIOUS_MEMBER_ENV: "execute-me" },
      },
    } satisfies TaskRecord & {
      readonly spawn_spec: {
        readonly cwd: string
        readonly extensions: readonly string[]
        readonly member_env: Readonly<Record<string, string>>
      }
    }
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
      waitForExit: () => Promise.resolve({
        kind: "clean" as const,
        facts: { pid: 4321, code: 0, signal: null, stderrTail: "" },
      }),
      lastSeen: () => undefined,
      switchSession: () => Promise.resolve({ cancelled: false }),
    } satisfies RpcChildHandle
    let extensions: readonly string[] | undefined
    let memberEnv: Readonly<Record<string, string>> | undefined
    let cwd: string | undefined
    let model: string | undefined
    let variant: string | undefined
    let plannerInput: Parameters<ReturnType<typeof categoryPlanner>>[0] | undefined
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const runner = new FakeRunner()
    const manager = createTaskManager({
      store,
      runners: { "in-process": runner, process: runner },
      planner: (spec) => {
        plannerInput = spec
        return categoryPlanner()(spec)
      },
      config: settings(),
      cwd: project,
      trustedRespawnAdmission: async () => ({ callerRole: "coordinator", lineage: "known", rootSessionId: "parent-1", childDepth: 1 } as const),
      rpcRespawnRunner: {
        start: (spec) => {
          extensions = spec.extensions
          memberEnv = spec.memberEnv
          cwd = spec.cwd
          model = spec.model
          variant = spec.variant
          return handle
        },
      },
    })

    // when
    const result = await manager.respawn(maliciousRecord, "parent-1", "/tmp/session.jsonl")

    // then
    expect(result.ok).toBe(true)
    expect(extensions).toBeUndefined()
    expect(memberEnv).toEqual({ SENPI_TASK_LINEAGE_TASK_ID: record.task_id })
    expect(cwd).toBe(project)
    expect(model).toBe("anthropic/claude")
    expect(variant).toBeUndefined()
    expect(plannerInput?.root_session_id).toBe("parent-1")
    expect(plannerInput?.depth).toBe(1)
  })
})

describe("TaskManager team-member respawn", () => {
  test("#given a team member record #when respawned #then current trusted launch settings replace persisted extension and env", async () => {
    // given
    const record: TaskRecord = {
      ...respawnRecord(),
      name: "team:11111111-1111-4111-8111-111111111111:alpha",
      pid: 1234,
    }
    const trustedLaunch = {
      extensions: ["/trusted/member-extension.js", "/trusted/provider-extension.js"],
      memberEnv: {
        SENPI_TASK_MEMBER: "11111111-1111-4111-8111-111111111111::alpha",
        SENPI_TASK_MEMBER_TASK_ID: record.task_id,
        SENPI_TASK_TEAM_CONFIG: '{"members":["alpha"]}',
      },
    }
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
      waitForExit: () => Promise.resolve({
        kind: "clean" as const,
        facts: { pid: 4321, code: 0, signal: null, stderrTail: "" },
      }),
      lastSeen: () => undefined,
      switchSession: () => {
        pidDuringSwitch = store.load(record.task_id)?.pid
        return Promise.resolve({ cancelled: false })
      },
    } satisfies RpcChildHandle
    let startedSpec: RpcRunnerSpec | undefined
    let pidDuringSwitch: number | undefined
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.save(record)
    const runner = new FakeRunner()
    const options = {
      store,
      runners: { "in-process": runner, process: runner },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
      trustedRespawnAdmission: async () => ({ callerRole: "coordinator", lineage: "known", rootSessionId: "parent-1", childDepth: 1 } as const),
      rpcRespawnRunner: {
        start: (spec: RpcRunnerSpec) => {
          startedSpec = spec
          return handle
        },
      },
      trustedRespawnLaunch: async () => trustedLaunch,
    }
    const manager = createTaskManager(options)

    // when
    const result = await manager.respawn(record, "parent-1", "/tmp/session.jsonl")

    // then
    expect(result.ok).toBe(true)
    expect(startedSpec?.extensions).toEqual(trustedLaunch.extensions)
    expect(startedSpec?.memberEnv).toEqual({
      ...trustedLaunch.memberEnv,
      SENPI_TASK_LINEAGE_TASK_ID: record.task_id,
    })
    expect(pidDuringSwitch).toBe(4321)
  })
})

describe("TaskManager respawn variant", () => {
  test("#given a record whose resolved model carried a variant #when respawned #then the variant reaches the rpc runner spec", async () => {
    // given
    const record: TaskRecord = {
      ...respawnRecord(),
      resolved_model: {
        source: "agent",
        provider: "openai",
        model_id: "gpt-5.6-sol",
        display: "openai/gpt-5.6-sol",
        variant: "xhigh",
      },
    }
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
      waitForExit: () => Promise.resolve({
        kind: "clean" as const,
        facts: { pid: 4321, code: 0, signal: null, stderrTail: "" },
      }),
      lastSeen: () => undefined,
      switchSession: () => Promise.resolve({ cancelled: false }),
    } satisfies RpcChildHandle
    let startedSpec: RpcRunnerSpec | undefined
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const runner = new FakeRunner()
    const manager = createTaskManager({
      store,
      runners: { "in-process": runner, process: runner },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
      trustedRespawnAdmission: async () => ({ callerRole: "coordinator", lineage: "known", rootSessionId: "parent-1", childDepth: 1 } as const),
      rpcRespawnRunner: {
        start: (spec: RpcRunnerSpec) => {
          startedSpec = spec
          return handle
        },
      },
    })

    // when
    const result = await manager.respawn(record, "parent-1", "/tmp/session.jsonl")

    // then
    expect(result.ok).toBe(true)
    expect(startedSpec?.variant).toBeUndefined()
  })
})
