import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import type { TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { FakeRunner, categoryPlanner, cleanupProjects, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import type { ManagedStartSpec } from "./types"
import { createTaskManager } from "./manager"
import { createParentRegistrySessionContext } from "./parent-registry-context"
import { createInProcessManagedRunner } from "./runner"

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
    notify_on_terminal: false,
    status: "running",
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
      rpcRespawnRunner: { start: async () => handle },
    })

    // when
    const result = await manager.respawn(record, "/tmp/session.jsonl")

    // then
    expect(result).toEqual({
      ok: false,
      disposition: "retryable",
      code: "respawn_failed",
      reason: "rpc respawn cleanup failed",
    })
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
        start: async (spec) => {
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
        start: async (spec: RpcRunnerSpec) => {
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
        start: async (spec: RpcRunnerSpec) => {
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

describe("TaskManager in-process respawn", () => {
  test("#given a claimed in-process record #when respawned #then resume receives the rebuilt persisted spec", async () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.list()
    const record: TaskRecord = {
      ...respawnRecord(),
      execution_mode: "in-process",
      host_pid: 7001,
      resolved_model: {
        source: "agent",
        provider: "anthropic",
        model_id: "claude",
        display: "Claude",
      },
      tool_allow: ["read"],
      tool_deny: ["write"],
      spawn_spec: {
        version: 1,
        cwd: project,
        prompt: "persisted effective prompt",
        instructions: "persisted instructions",
        member_scoped_tool_names: ["team_ping"],
      },
    }
    store.replace(record)
    let resumedSpec: ManagedStartSpec | undefined
    let resumedPath: string | undefined
    const restored = makeHandle(record.task_id)
    const inProcessRunner = {
      start: () => Promise.resolve(restored.handle),
      resume: (spec: ManagedStartSpec, sessionPath: string) => {
        resumedSpec = spec
        resumedPath = sessionPath
        return Promise.resolve(restored.handle)
      },
    }
    const manager = createTaskManager({
      store,
      runners: { "in-process": inProcessRunner, process: new FakeRunner() },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
      hostPid: 7001,
    })

    // when
    const result = await manager.respawn(record, "/tmp/in-process-session.jsonl")

    // then
    expect(result.ok).toBe(true)
    expect(resumedPath).toBe("/tmp/in-process-session.jsonl")
    expect(resumedSpec).toMatchObject({
      taskId: record.task_id,
      prompt: "persisted effective prompt",
      instructions: "persisted instructions",
      resolvedModel: record.resolved_model,
      toolAllowlist: ["read"],
      toolDenylist: ["write"],
      memberScopedToolNames: ["team_ping"],
    })
  })

  test("#given resolveResumeContext cannot find the persisted model #when respawned #then failure is retryable and no child is spawned", async () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const record: TaskRecord = {
      ...respawnRecord(),
      execution_mode: "in-process",
      resolved_model: {
        source: "agent",
        provider: "removed-provider",
        model_id: "removed-model",
        display: "Removed Model",
      },
      spawn_spec: { version: 1, cwd: project, prompt: "continue safely" },
    }
    let childResumeCalls = 0
    const managedRunner = createInProcessManagedRunner({
      start: () => {
        throw new Error("start must not be called during respawn")
      },
      resume: () => {
        childResumeCalls += 1
        throw new Error("resume must be guarded before child spawn")
      },
    }, createParentRegistrySessionContext(() => undefined))
    const manager = createTaskManager({
      store,
      runners: { "in-process": managedRunner, process: new FakeRunner() },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
    })

    // when
    const result = await manager.respawn(record, "/tmp/session.jsonl")

    // then
    expect(result).toEqual({
      ok: false,
      disposition: "retryable",
      code: "model_unavailable",
      reason: "no live parent model registry available",
    })
    expect(childResumeCalls).toBe(0)
  })

  test("#given an in-process record without v1 rebuild facts #when respawned #then it fails unrecoverably without spawning", async () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const record: TaskRecord = { ...respawnRecord(), execution_mode: "in-process" }
    let resumeCalls = 0
    const runner = {
      start: () => Promise.resolve(makeHandle(record.task_id).handle),
      resume: () => {
        resumeCalls += 1
        return Promise.resolve(makeHandle(record.task_id).handle)
      },
    }
    const manager = createTaskManager({
      store,
      runners: { "in-process": runner, process: new FakeRunner() },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
    })

    // when
    const result = await manager.respawn(record, "/tmp/session.jsonl")

    // then
    expect(result).toEqual({
      ok: false,
      disposition: "unrecoverable",
      code: "spawn_spec_unavailable",
      reason: "record has no persisted v1 spawn_spec to rebuild from",
    })
    expect(resumeCalls).toBe(0)
  })
})

describe("TaskManager guarded reattach", () => {
  test("#given no prior host ownership claim #when reattached #then the handle is rejected", async () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.list()
    const { host_pid: _hostPid, ...record } = respawnRecord()
    store.replace(record)
    const manager = createTaskManager({
      store,
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
      hostPid: 7001,
    })

    // when
    const result = await manager.reattach(record, makeHandle(record.task_id).handle)

    // then
    expect(result).toEqual({ ok: false, kind: "failed", reason: "task ownership claim is not held by this host" })
  })

  test("#given a claimed non-terminal record with stale output #when reattached #then output clears and run_epoch bumps exactly once", async () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.list()
    const record: TaskRecord = {
      ...respawnRecord(),
      status: "running",
      error_message: "stale error",
      final_response: "stale response",
      host_pid: 7001,
      notification: { run_epoch: 4, notified_epoch: 3 },
    }
    store.replace(record)
    const manager = createTaskManager({
      store,
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
      hostPid: 7001,
    })

    // when
    const result = await manager.reattach(record, makeHandle(record.task_id).handle)

    // then
    expect(result).toEqual({ ok: true })
    expect(store.load(record.task_id)).toMatchObject({
      status: "running",
      notification: { run_epoch: 5, notified_epoch: 3 },
    })
    expect(store.load(record.task_id)?.error_message).toBeUndefined()
    expect(store.load(record.task_id)?.final_response).toBeUndefined()
  })

  test("#given a claimed terminal record #when reattached #then run_epoch is unchanged", async () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.list()
    const record: TaskRecord = {
      ...respawnRecord(),
      status: "completed",
      final_response: "done",
      host_pid: 7001,
      notification: { run_epoch: 4, notified_epoch: 3 },
    }
    store.replace(record)
    const manager = createTaskManager({
      store,
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: categoryPlanner(),
      config: settings(),
      cwd: project,
      hostPid: 7001,
    })

    // when
    const result = await manager.reattach(record, makeHandle(record.task_id).handle)

    // then
    expect(result).toEqual({ ok: true })
    expect(store.load(record.task_id)?.notification.run_epoch).toBe(4)
  })
})

describe("TaskManager respawn continuation", () => {
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
      rpcRespawnRunner: { start: async () => handle },
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
    expect(followUpCalls).toHaveLength(1)
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
    expect(followUpCalls).toHaveLength(1)
  })

  test("#given a trailing user message #when respawned #then the revived child gets exactly one continuation followUp", async () => {
    // given
    const sessionPath = writeSession([
      `{"type":"message","message":{"role":"user","content":[{"type":"text","text":"continue"}]}}`,
    ])
    const { manager, followUpCalls } = continuationHarness()

    // when
    const result = await manager.respawn(respawnRecord(), sessionPath)

    // then
    expect(result.ok).toBe(true)
    expect(followUpCalls).toHaveLength(1)
  })

  test("#given an aborted assistant tail #when respawned #then the revived child gets exactly one continuation followUp", async () => {
    // given
    const sessionPath = writeSession([
      `{"type":"message","message":{"role":"assistant","stopReason":"aborted","content":[{"type":"text","text":"partial"}]}}`,
    ])
    const { manager, followUpCalls } = continuationHarness()

    // when
    const result = await manager.respawn(respawnRecord(), sessionPath)

    // then
    expect(result.ok).toBe(true)
    expect(followUpCalls).toHaveLength(1)
  })

  test("#given a terminal record with a user tail #when respawned #then no continuation is sent", async () => {
    // given
    const sessionPath = writeSession([
      `{"type":"message","message":{"role":"user","content":[{"type":"text","text":"stale"}]}}`,
    ])
    const { manager, followUpCalls } = continuationHarness()

    // when
    const result = await manager.respawn({ ...respawnRecord(), status: "completed", final_response: "done" }, sessionPath)

    // then
    expect(result.ok).toBe(true)
    expect(followUpCalls).toEqual([])
  })

  test("#given a completed assistant JSON line larger than 64 KiB #when respawned #then no preceding user false-positive continuation is sent", async () => {
    // given
    const sessionPath = writeSession([
      `{"type":"message","message":{"role":"user","content":[{"type":"text","text":"work"}]}}`,
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "x".repeat(70 * 1024) }] },
      }),
    ])
    const { manager, followUpCalls } = continuationHarness()

    // when
    const result = await manager.respawn(respawnRecord(), sessionPath)

    // then
    expect(result.ok).toBe(true)
    expect(followUpCalls).toEqual([])
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
