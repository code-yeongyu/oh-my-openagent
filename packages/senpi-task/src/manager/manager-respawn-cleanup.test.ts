import { writeFileSync } from "node:fs"
import { join } from "node:path"

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

describe("TaskManager respawn launch trust boundary", () => {
  test("#given persisted extension and member env inputs #when respawned #then neither reaches the current runner", async () => {
    // given
    const record = respawnRecord()
    const maliciousRecord: TaskRecord = {
      ...record,
      spawn_spec: {
        cwd: record.spawn_spec?.cwd ?? "/tmp/project",
        extensions: ["/tmp/malicious-extension.ts"],
        member_env: { MALICIOUS_MEMBER_ENV: "execute-me" },
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
    let extensions: readonly string[] | undefined
    let memberEnv: Readonly<Record<string, string>> | undefined
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const runner = new FakeRunner()
    const manager = createTaskManager({
      store,
      runners: { "in-process": runner, process: runner },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
      rpcRespawnRunner: {
        start: (spec) => {
          extensions = spec.extensions
          memberEnv = spec.memberEnv
          return handle
        },
      },
    })

    // when
    const result = await manager.respawn(maliciousRecord, "/tmp/session.jsonl")

    // then
    expect(result.ok).toBe(true)
    expect(extensions).toBeUndefined()
    expect(memberEnv).toBeUndefined()
  })
})

describe("TaskManager team-member respawn", () => {
  test("#given a team member record #when respawned #then current trusted launch settings replace persisted extension and env", async () => {
    // given
    const record: TaskRecord = {
      ...respawnRecord(),
      name: "team:11111111-1111-4111-8111-111111111111:alpha",
      spawn_spec: {
        cwd: "/tmp/project",
        extensions: ["/tmp/malicious-extension.ts"],
        member_env: { SENPI_TASK_MEMBER: "untrusted::member" },
      },
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
      switchSession: () => Promise.resolve({ cancelled: false }),
    } satisfies RpcChildHandle
    let startedSpec: RpcRunnerSpec | undefined
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const runner = new FakeRunner()
    const options = {
      store,
      runners: { "in-process": runner, process: runner },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
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
    const result = await manager.respawn(record, "/tmp/session.jsonl")

    // then
    expect(result.ok).toBe(true)
    expect(startedSpec?.extensions).toEqual(trustedLaunch.extensions)
    expect(startedSpec?.memberEnv).toEqual(trustedLaunch.memberEnv)
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
      rpcRespawnRunner: {
        start: (spec: RpcRunnerSpec) => {
          startedSpec = spec
          return handle
        },
      },
    })

    // when
    const result = await manager.respawn(record, "/tmp/session.jsonl")

    // then
    expect(result.ok).toBe(true)
    expect(startedSpec?.variant).toBe("xhigh")
  })
})

describe("TaskManager respawn continuation", () => {
  const CONTINUATION_MESSAGE =
    "Your previous turn was interrupted by a host process restart. Resume your task from its current state and finish it - do not restart from scratch, and do not repeat work already recorded in this session."

  function writeSession(lines: string[]): string {
    const project = tempProject()
    const path = join(project, "session.jsonl")
    writeFileSync(path, lines.join("\n"), "utf8")
    return path
  }

  function continuationHarness(switchCancelled = false) {
    const followUpCalls: string[] = []
    const handle = {
      task_id: "st_deadbeef",
      sessionId: "respawned-session",
      pid: 4321,
      steer: () => Promise.resolve(),
      followUp: (text: string) => {
        followUpCalls.push(text)
        return Promise.resolve()
      },
      abort: () => Promise.resolve(),
      subscribe: () => () => {},
      waitForIdle: () => Promise.resolve(),
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
      terminate: () => Promise.resolve(),
      exitOutcome: () => undefined,
      waitForExit: () =>
        Promise.resolve({ kind: "clean" as const, facts: { pid: 4321, code: 0, signal: null, stderrTail: "" } }),
      lastSeen: () => undefined,
      switchSession: () => Promise.resolve({ cancelled: switchCancelled }),
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
    return { manager, followUpCalls }
  }

  test("#given a toolResult tail #when respawned #then the revived child gets a continuation followUp", async () => {
    // given a session interrupted between tool result and the next assistant message
    const sessionPath = writeSession([
      `{"type":"session","version":3,"id":"s"}`,
      `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"half done"}]}}`,
      `{"type":"message","message":{"role":"toolResult","content":[{"type":"text","text":"tool output"}]}}`,
    ])
    const { manager, followUpCalls } = continuationHarness()

    // when
    const result = await manager.respawn(respawnRecord(), sessionPath)

    // then
    expect(result.ok).toBe(true)
    expect(followUpCalls).toEqual([CONTINUATION_MESSAGE])
  })

  test("#given an assistant toolCall tail #when respawned #then the revived child gets a continuation followUp", async () => {
    // given a session killed mid tool-dispatch
    const sessionPath = writeSession([
      `{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{}}]}}`,
    ])
    const { manager, followUpCalls } = continuationHarness()

    // when
    const result = await manager.respawn(respawnRecord(), sessionPath)

    // then
    expect(result.ok).toBe(true)
    expect(followUpCalls).toEqual([CONTINUATION_MESSAGE])
  })

  test("#given an assistant text-only tail #when respawned #then no continuation is sent", async () => {
    // given a session whose turn completed before the kill
    const sessionPath = writeSession([
      `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"finished"},{"type":"thinking","thinking":"done"}]}}`,
    ])
    const { manager, followUpCalls } = continuationHarness()

    // when
    const result = await manager.respawn(respawnRecord(), sessionPath)

    // then
    expect(result.ok).toBe(true)
    expect(followUpCalls).toEqual([])
  })

  test("#given an unreadable session path #when respawned #then no continuation is sent and respawn still succeeds", async () => {
    // given
    const { manager, followUpCalls } = continuationHarness()

    // when
    const result = await manager.respawn(respawnRecord(), "/tmp/definitely-missing-session.jsonl")

    // then
    expect(result.ok).toBe(true)
    expect(followUpCalls).toEqual([])
  })
})
