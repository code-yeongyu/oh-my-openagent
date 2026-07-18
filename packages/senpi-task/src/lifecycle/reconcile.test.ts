import { mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { FakeRunner, flush } from "../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../manager/manager"
import { createTeamMemberRespawnLaunchResolver } from "../team/member-respawn"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import type { ManagedChildHandle } from "../manager/child-handle"
import type { TaskRecord, TaskStatus } from "../state"
import type { TaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import type { ProcessSignaller } from "./port"
import {
  cleanupProjects,
  fakeHandle,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
} from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

type SignalCall = { readonly pid: number; readonly signal: string }

function fakeSignaller(alive: Set<number>, calls: SignalCall[]): ProcessSignaller {
  return {
    isAlive: (pid) => alive.has(pid),
    signal: (pid, signal) => {
      calls.push({ pid, signal })
      alive.delete(pid)
    },
  }
}

const now = () => 5_000_000

function seedProcessRecord(store: TaskRecordStore, taskId: string, status: TaskStatus = "running"): TaskRecord {
  const record = seedRecord(store, { task_id: taskId, status, residency_state: "resident", execution_mode: "process", pid: 900, updated_at: new Date(now() - 1_000).toISOString() })
  const persisted: TaskRecord = {
    ...record,
    spawn_spec: { cwd: "/tmp/project", extensions: ["/tmp/member-extension.ts"], member_env: { SENPI_TASK_MEMBER: "run-1::alpha" } },
  }
  store.replace(persisted)
  return persisted
}

function persistSessions(store: TaskRecordStore, taskId: string): string {
  const directory = resolveChildSessionDir(join(store.stateDir, "children", taskId), taskId)
  mkdirSync(directory, { recursive: true })
  const older = join(directory, "2026-07-11_old.jsonl")
  const newest = join(directory, "2026-07-12_new.jsonl")
  writeFileSync(older, "{}\n")
  writeFileSync(newest, "{}\n")
  utimesSync(older, new Date(1_000), new Date(1_000))
  utimesSync(newest, new Date(2_000), new Date(2_000))
  return newest
}

type RespawnControl = { readonly switchCalls: string[]; settle(): void; readonly terminated: () => number; readonly disposed: () => number }

class FakeRespawnRunner {
  readonly startedSpecs: RpcRunnerSpec[] = []
  readonly controls: RespawnControl[] = []
  cancelSwitch = false

  start(spec: RpcRunnerSpec): RpcChildHandle {
    this.startedSpecs.push(spec)
    let resolveIdle: () => void = () => {}
    const idle = new Promise<void>((resolve) => {
      resolveIdle = resolve
    })
    let terminated = 0
    let disposed = 0
    const switchCalls: string[] = []
    const pid = 1_000 + this.startedSpecs.length
    const handle: RpcChildHandle = {
      task_id: spec.task_id, sessionId: `resumed-${spec.task_id}`, pid,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => {},
      waitForIdle: () => idle,
      lastAssistantText: () => "reattached result",
      dispose: async () => { disposed += 1 },
      terminate: async () => { terminated += 1 },
      exitOutcome: () => undefined,
      waitForExit: () => Promise.resolve({ kind: "clean", facts: { pid, code: 0, signal: null, stderrTail: "" } }),
      lastSeen: () => undefined,
      switchSession: async (sessionPath) => {
        switchCalls.push(sessionPath)
        return { cancelled: this.cancelSwitch }
      },
    }
    this.controls.push({ switchCalls, settle: resolveIdle, terminated: () => terminated, disposed: () => disposed })
    return handle
  }
}

class EffectiveSpawnRunner extends FakeRunner {
  override async start(spec: Parameters<FakeRunner["start"]>[0]) {
    const handle = await super.start(spec)
    return {
      ...handle,
      spawnSpec: { cwd: spec.cwd, extensions: ["/tmp/inherited-extension.ts"], memberEnv: { SENPI_TASK_MEMBER: "run-1::alpha" } },
    }
  }
}

function createManager(store: TaskRecordStore, respawnRunner: FakeRespawnRunner, defaultConcurrency = 5, processRunner = new FakeRunner()) {
  const inProcess = new FakeRunner()
  const manager = createTaskManager({
    store,
    runners: { "in-process": inProcess, process: processRunner },
    planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
    config: settings({ default_concurrency: defaultConcurrency }),
    cwd: "/tmp/project",
    rpcRespawnRunner: respawnRunner,
  })
  return { manager, inProcess }
}

type HarnessOptions = {
  readonly taskId: string; readonly status?: TaskStatus; readonly sessions?: boolean; readonly alive?: boolean
  readonly config?: Record<string, unknown>; readonly registry?: FakeRegistry
  readonly concurrency?: number; readonly processRunner?: FakeRunner
}

function createHarness(options: HarnessOptions) {
  const store = tempStore()
  seedProcessRecord(store, options.taskId, options.status)
  const sessionPath = options.sessions === false ? undefined : persistSessions(store, options.taskId)
  const respawnRunner = new FakeRespawnRunner()
  const managed = createManager(store, respawnRunner, options.concurrency, options.processRunner)
  const signals: SignalCall[] = []
  const alive = options.alive === true ? new Set([900]) : new Set<number>()
  const lifecycle = createTaskLifecycle({ store, registry: options.registry ?? new FakeRegistry(), config: settings(options.config), now, signaller: fakeSignaller(alive, signals), orphanKillDelayMs: 0 })
  return { store, sessionPath, respawnRunner, signals, lifecycle, ...managed }
}

describe("reconcileOnSessionStart reattach", () => {
  test(" w2reattach #given a dead process and persisted sessions #when reconciled #then the newest session is respawned running at epoch plus one", async () => {
    // given
    const { store, sessionPath, respawnRunner, manager, lifecycle } = createHarness({ taskId: "st_00000001" })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("resumed")
    if (sessionPath === undefined) throw new Error("expected a persisted session path")
    expect(respawnRunner.startedSpecs[0]?.resumeSessionPath).toBe(sessionPath)
    expect(respawnRunner.controls[0]?.switchCalls).toEqual([sessionPath])
    expect(store.load("st_00000001")?.status).toBe("running")
    expect(store.load("st_00000001")?.notification.run_epoch).toBe(1)
    expect(manager.getResidentHandle("st_00000001")?.pid).toBe(1001)
  })
  test(" w2reattach #given injected reattach ports and a registered store fallback #when reconciled #then the injected ports take precedence", async () => {
    // given
    const { store, sessionPath } = createHarness({ taskId: "st_0000000d" })
    const calls: string[] = []
    const injectedHandle: ManagedChildHandle = {
      task_id: "st_0000000d",
      sessionId: "injected-session",
      pid: 1001,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      subscribe: () => () => undefined,
      waitForOutcome: async () => ({ status: "completed", finalResponse: "" }),
      lastAssistantText: () => undefined,
      dispose: async () => undefined,
    }
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings(),
      now,
      signaller: fakeSignaller(new Set(), []),
      respawn: async (record, path) => {
        calls.push(`respawn:${record.task_id}:${path}`)
        return { ok: true, handle: injectedHandle }
      },
      reattach: async (record, handle) => {
        calls.push(`reattach:${record.task_id}:${handle.sessionId}`)
        return { ok: true }
      },
    })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    if (sessionPath === undefined) throw new Error("expected a persisted session path")
    expect(result.outcomes[0]?.kind).toBe("resumed")
    expect(calls).toEqual([
      `respawn:st_0000000d:${sessionPath}`,
      "reattach:st_0000000d:injected-session",
    ])
  })


  test(" w2reattach #given a dead process without a session #when reconciled #then it remains lost without respawn", async () => {
    // given
    const { store, respawnRunner, lifecycle } = createHarness({ taskId: "st_00000002", sessions: false })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(store.load("st_00000002")?.status).toBe("lost")
    expect(store.load("st_00000002")?.residency_state).toBe("disposed")
    expect(respawnRunner.startedSpecs).toHaveLength(0)
  })

  test(" w2reattach #given a live foreign process and persisted session #when reconciled #then it is terminated before respawn reattach", async () => {
    // given
    const { store, respawnRunner, signals, lifecycle } = createHarness({ taskId: "st_00000003", alive: true })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(signals).toEqual([{ pid: 900, signal: "SIGTERM" }])
    expect(respawnRunner.startedSpecs).toHaveLength(1)
    expect(result.outcomes[0]?.kind).toBe("resumed")
    expect(store.load("st_00000003")?.status).toBe("running")
    expect(store.load("st_00000003")?.residency_state).toBe("resident")
  })

  test(" w2reattach #given an in-process record #when reconciled #then the previous-process task is lost and never respawned", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000004", status: "running", residency_state: "resident", execution_mode: "in-process" })
    const respawnRunner = new FakeRespawnRunner()
    createManager(store, respawnRunner)
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), now, signaller: fakeSignaller(new Set(), []) })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(respawnRunner.startedSpecs).toHaveLength(0)
  })
  test(" w2reattach #given an in-process record marked lost #when reconciled #then its residency claim is released so the slot is reclaimable", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000011", status: "running", residency_state: "resident", execution_mode: "in-process" })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), now, signaller: fakeSignaller(new Set(), []), orphanKillDelayMs: 0 })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(store.load("st_00000011")?.status).toBe("lost")
    expect(store.load("st_00000011")?.residency_state).toBe("disposed")
  })

  test(" w2reattach #given a leaked {lost, resident} record from an earlier session #when reconciled #then it self-heals to disposed", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000012", status: "lost", residency_state: "resident", execution_mode: "in-process" })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), now, signaller: fakeSignaller(new Set(), []), orphanKillDelayMs: 0 })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(store.load("st_00000012")?.residency_state).toBe("disposed")
  })

  test(" w2reattach #given reconcile reattach is disabled #when a durable session exists #then v1 lost behavior runs without respawn", async () => {
    // given
    const { store, respawnRunner, lifecycle } = createHarness({ taskId: "st_00000005", config: { reattach_on_reconcile: false } })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(store.load("st_00000005")?.status).toBe("lost")
    expect(respawnRunner.startedSpecs).toHaveLength(0)
  })

  test(" w2reattach #given this process already owns the live handle #when reconciled #then the record is skipped without signalling or respawn", async () => {
    // given
    const registry = new FakeRegistry()
    registry.add(fakeHandle("st_00000006", "rpc", [], { pid: 900 }))
    const { store, signals, lifecycle } = createHarness({ taskId: "st_00000006", alive: true, registry })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("resumed")
    expect(store.load("st_00000006")?.status).toBe("running")
    expect(signals).toHaveLength(0)
  })

  test(" w2reattach #given a completed resident daemon with a dead pid #when reconciled #then its process returns while the record stays terminal", async () => {
    // given
    const { store, manager, lifecycle } = createHarness({ taskId: "st_00000007", status: "completed" })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("resumed")
    expect(store.load("st_00000007")?.status).toBe("completed")
    expect(store.load("st_00000007")?.notification.run_epoch).toBe(0)
    expect(manager.getResidentHandle("st_00000007")?.pid).toBe(1001)
  })

  test(" w2reattach #given a completed resident daemon with a live foreign pid #when reconciled #then it is terminated before reattach", async () => {
    // given
    const { store, manager, signals, lifecycle } = createHarness({ taskId: "st_0000000a", status: "completed", alive: true })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(signals).toEqual([{ pid: 900, signal: "SIGTERM" }])
    expect(result.outcomes[0]?.kind).toBe("resumed")
    expect(store.load("st_0000000a")?.status).toBe("completed")
    expect(store.load("st_0000000a")?.residency_state).toBe("resident")
    expect(manager.getResidentHandle("st_0000000a")?.pid).toBe(1001)
  })

  test(" w2reattach #given overlapping reconcile sweeps #when both respawn #then the duplicate child is discarded without replacing the owner", async () => {
    // given
    const { store, respawnRunner, manager, lifecycle } = createHarness({ taskId: "st_0000000b" })

    // when
    const results = await Promise.all([lifecycle.reconcileOnSessionStart(), lifecycle.reconcileOnSessionStart()])

    // then
    expect(respawnRunner.startedSpecs).toHaveLength(2)
    expect(respawnRunner.controls[1]?.terminated()).toBe(1)
    expect(respawnRunner.controls[1]?.disposed()).toBe(1)
    expect(results.flatMap((result) => result.outcomes.map((outcome) => outcome.kind))).toEqual(["resumed", "resumed"])
    expect(store.load("st_0000000b")?.notification.run_epoch).toBe(1)
    expect(manager.getResidentHandle("st_0000000b")?.pid).toBe(1001)
  })

  test(" w2reattach #given a process runner reports effective launch inputs #when persisted record is reloaded #then only safe spawn facts survive", async () => {
    // given
    const processRunner = new EffectiveSpawnRunner()
    const { store, manager } = createHarness({ taskId: "st_0000000c", processRunner })

    // when
    const result = await manager.start({ prompt: "bootstrap", parent_session_id: "parent-1", depth: 1, execution_mode: "process" })

    // then
    if (result.kind !== "started") throw new Error("expected started task")
    expect(store.load(result.task_id)?.spawn_spec).toEqual({ cwd: "/tmp/project" })
  })

  test(" w2reattach #given switch_session is cancelled #when reconciled #then the fresh child is torn down and the record stays lost", async () => {
    // given
    const { store, respawnRunner, manager, lifecycle } = createHarness({ taskId: "st_00000008" })
    respawnRunner.cancelSwitch = true

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(store.load("st_00000008")?.status).toBe("lost")
    expect(respawnRunner.controls[0]?.terminated()).toBe(1)
    expect(respawnRunner.controls[0]?.disposed()).toBe(1)
    expect(manager.getResidentHandle("st_00000008")).toBeUndefined()
  })

  test(" w2reattach #given one trusted launch resolver rejection #when reconciling multiple process tasks #then later tasks still reattach", async () => {
    // given
    const store = tempStore()
    const rejectedRecord = seedProcessRecord(store, "st_0000000d")
    const healthyRecord = seedProcessRecord(store, "st_0000000e")
    persistSessions(store, rejectedRecord.task_id)
    persistSessions(store, healthyRecord.task_id)
    const respawnRunner = new FakeRespawnRunner()
    const inProcess = new FakeRunner()
    createTaskManager({
      store,
      runners: { "in-process": inProcess, process: inProcess },
      planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
      config: settings(),
      cwd: "/tmp/project",
      rpcRespawnRunner: respawnRunner,
      trustedRespawnLaunch: async (record) => {
        if (record.task_id === rejectedRecord.task_id) throw new Error("current team runtime unavailable")
        return undefined
      },
    })
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings(),
      now,
      signaller: fakeSignaller(new Set(), []),
      orphanKillDelayMs: 0,
    })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes.find((outcome) => outcome.task_id === rejectedRecord.task_id)?.kind).toBe("lost")
    expect(result.outcomes.find((outcome) => outcome.task_id === healthyRecord.task_id)?.kind).toBe("resumed")
    expect(respawnRunner.startedSpecs.map((spec) => spec.task_id)).toEqual([healthyRecord.task_id])
  })

  test(" w2reattach #given a team member whose current runtime is missing #when reconciling #then it is lost without blocking later records", async () => {
    // given
    const store = tempStore()
    const teamRecord = {
      ...seedProcessRecord(store, "st_0000000f"),
      name: "team:11111111-1111-4111-8111-111111111111:alpha",
    }
    store.replace(teamRecord)
    const healthyRecord = seedProcessRecord(store, "st_00000010")
    persistSessions(store, teamRecord.task_id)
    persistSessions(store, healthyRecord.task_id)
    const respawnRunner = new FakeRespawnRunner()
    const inProcess = new FakeRunner()
    createTaskManager({
      store,
      runners: { "in-process": inProcess, process: inProcess },
      planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
      config: settings(),
      cwd: "/tmp/project",
      rpcRespawnRunner: respawnRunner,
      trustedRespawnLaunch: createTeamMemberRespawnLaunchResolver({
        stateDir: { project_dir: store.stateDir },
        taskSettings: settings(),
        memberExtension: {
          entryPath: "/trusted/member-extension.js",
          inheritedExtensions: ["/trusted/provider-extension.js"],
        },
      }),
    })
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings(),
      now,
      signaller: fakeSignaller(new Set(), []),
      orphanKillDelayMs: 0,
    })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes.find((outcome) => outcome.task_id === teamRecord.task_id)?.kind).toBe("lost")
    expect(result.outcomes.find((outcome) => outcome.task_id === healthyRecord.task_id)?.kind).toBe("resumed")
    expect(respawnRunner.startedSpecs.map((spec) => spec.task_id)).toEqual([healthyRecord.task_id])
    expect(respawnRunner.startedSpecs[0]?.extensions).toEqual(["/trusted/provider-extension.js"])
    expect(respawnRunner.startedSpecs[0]?.memberEnv).toBeUndefined()
  })

  test(" w2reattach #given one concurrency slot and two queued tasks #when a reattached task completes #then only the first queued task starts", async () => {
    // given
    const { store, respawnRunner, manager, inProcess, lifecycle } = createHarness({ taskId: "st_00000009", concurrency: 1, config: { default_concurrency: 1 } })
    await lifecycle.reconcileOnSessionStart()

    // when
    const firstQueued = await manager.start({ prompt: "next", parent_session_id: "parent-1", depth: 1, execution_mode: "in-process" })
    const secondQueued = await manager.start({ prompt: "later", parent_session_id: "parent-1", depth: 1, execution_mode: "in-process" })
    if (firstQueued.kind !== "started" || secondQueued.kind !== "started") throw new Error("expected queued tasks")
    expect(firstQueued.status).toBe("pending")
    expect(secondQueued.status).toBe("pending")
    respawnRunner.controls[0]?.settle()
    await flush()
    await flush()

    // then
    expect(store.load("st_00000009")?.status).toBe("completed")
    expect(store.load(firstQueued.task_id)?.status).toBe("running")
    expect(store.load(secondQueued.task_id)?.status).toBe("pending")
    inProcess.handles.get(firstQueued.task_id)?.settle({ status: "completed", finalResponse: "done" })
    await flush()
    expect(store.load(secondQueued.task_id)?.status).toBe("running")
  })
})
