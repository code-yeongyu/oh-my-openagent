import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { FakeRunner, flush } from "../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../manager/manager"
import type { ManagedChildHandle } from "../manager/child-handle"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import type { PendingSteeringEntry, TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { acquireSessionAdmissionLease } from "./admission-lease"
import { createTaskLifecycle } from "./create"
import type { ProcessSignaller, RespawnResult } from "./port"
import { cleanupProjects, FakeRegistry, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const parentSessionId = "session-resumed"
const hostPid = 2222
const now = () => 9_000_000
const raceWorkerPath = resolve(import.meta.dir, "__fixtures__", "reconcile-race-worker.ts")

type Launch = { readonly taskId: string; readonly sessionPath: string | undefined }

function withV1(store: TaskRecordStore, record: TaskRecord, prompt = `prompt:${record.task_id}`): TaskRecord {
  const updated: TaskRecord = {
    ...record,
    spawn_spec: { version: 1, cwd: "/tmp/project", prompt },
  }
  store.replace(updated)
  return updated
}

function persistSession(store: TaskRecordStore, taskId: string): string {
  const directory = resolveChildSessionDir(join(store.stateDir, "children", taskId), taskId)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, "resume.jsonl")
  writeFileSync(path, "{}\n")
  utimesSync(path, new Date(2_000), new Date(2_000))
  return path
}

function managedHandle(taskId: string, calls: string[] = []): ManagedChildHandle {
  return {
    task_id: taskId,
    sessionId: `session:${taskId}`,
    pid: undefined,
    steer: async (message) => { calls.push(`steer:${message}`) },
    followUp: async (message) => { calls.push(`followUp:${message}`) },
    abort: async () => undefined,
    subscribe: () => () => undefined,
    waitForOutcome: () => new Promise(() => undefined),
    lastAssistantText: () => undefined,
    dispose: async () => undefined,
  }
}

function injectedHarness(options: {
  readonly store?: TaskRecordStore
  readonly config?: Record<string, unknown>
  readonly alive?: Set<number>
  readonly onRespawn?: (record: TaskRecord, sessionPath: string | undefined) => Promise<RespawnResult>
} = {}) {
  const store = options.store ?? tempStore()
  const registry = new FakeRegistry()
  const launches: Launch[] = []
  const signals: Array<{ readonly pid: number; readonly signal: string }> = []
  const alive = options.alive ?? new Set<number>()
  const signaller: ProcessSignaller = {
    isAlive: (pid) => alive.has(pid),
    signal: (pid, signal) => {
      signals.push({ pid, signal })
      alive.delete(pid)
    },
  }
  const lifecycle = createTaskLifecycle({
    store,
    registry,
    config: settings(options.config),
    hostPid,
    now,
    signaller,
    orphanKillDelayMs: 0,
    respawn: async (record, sessionPath) => {
      launches.push({ taskId: record.task_id, sessionPath })
      return options.onRespawn?.(record, sessionPath) ?? success(record.task_id)
    },
    reattach: async (record) => {
      registry.add({
        task_id: record.task_id,
        kind: record.execution_mode === "process" ? "rpc" : "in-process",
        pid: record.pid,
        abort: async () => undefined,
        dispose: async () => undefined,
        terminate: async () => undefined,
      })
      return { ok: true }
    },
  })
  return { store, registry, launches, signals, lifecycle }
}

function success(taskId: string) {
  return { ok: true as const, handle: managedHandle(taskId) }
}

describe("reconcileOnSessionStart scoped revival", () => {
  test("#given a suspended in-process child of the resumed session #when session start reconciles #then it resumes through the in-process port", async () => {
    // given
    const harness = injectedHarness()
    const record = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_10000001", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    const sessionPath = persistSession(harness.store, record.task_id)

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(result.outcomes).toContainEqual({ task_id: record.task_id, kind: "resumed", reason: "respawned and reattached" })
    expect(harness.launches).toEqual([{ taskId: record.task_id, sessionPath }])
    expect(harness.store.load(record.task_id)?.residency_state).toBe("resident")
    expect(harness.store.load(record.task_id)?.host_pid).toBe(hostPid)
  })

  test("#given a legacy crash orphan of another session #when this session resumes #then the global process reattach still runs", async () => {
    // given
    const harness = injectedHarness()
    const other = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_10000015", parent_session_id: "session-other", status: "running",
      residency_state: "resident", execution_mode: "process", pid: 7400, host_pid: 9999,
    }))
    const sessionPath = persistSession(harness.store, other.task_id)

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(result.outcomes.find((entry) => entry.task_id === other.task_id)?.kind).toBe("resumed")
    expect(harness.launches).toContainEqual({ taskId: other.task_id, sessionPath })
  })

  test("#given a terminal record owned by a live sibling #when reconciled #then the early owner guard leaves it untouched", async () => {
    // given
    const store = tempStore()
    const record = seedRecord(store, {
      task_id: "st_10000016", parent_session_id: parentSessionId, status: "completed",
      residency_state: "resident", execution_mode: "process", pid: 7401, host_pid: 3333,
    })
    const harness = injectedHarness({ store, alive: new Set([3333, 7401]) })

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(result.outcomes).toContainEqual({ task_id: record.task_id, kind: "deferred", reason: "foreign_live_owner" })
    expect(harness.store.load(record.task_id)).toEqual({ ...record, terminal_at: record.updated_at })
    expect(harness.signals).toHaveLength(0)
  })

  test("#given a suspended child of another session #when this session resumes #then the other child is untouched", async () => {
    // given
    const harness = injectedHarness()
    const other = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_10000002", parent_session_id: "session-other", status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))

    // when
    await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(harness.launches).toHaveLength(0)
    expect(harness.store.load(other.task_id)).toEqual(other)
  })

  test("#given two managers racing one suspended child #when both reconcile #then one claims and the other defers", async () => {
    // given
    const store = tempStore()
    const record = withV1(store, seedRecord(store, {
      task_id: "st_10000003", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    persistSession(store, record.task_id)
    const first = injectedHarness({ store })
    const second = injectedHarness({ store })

    // when
    const results = await Promise.all([
      first.lifecycle.reconcileOnSessionStart(parentSessionId),
      second.lifecycle.reconcileOnSessionStart(parentSessionId),
    ])

    // then
    expect(first.launches.length + second.launches.length).toBe(1)
    expect(results.flatMap((entry) => entry.outcomes).map((entry) => entry.kind).sort()).toEqual(["deferred", "resumed"])
  })

  test("#given one in-process and one rpc child of this session plus another-session child #when reconciled #then only this session revives end to end", async () => {
    // given
    const harness = injectedHarness()
    const ownInProcess = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_10000017", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    const ownRpc = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_10000018", parent_session_id: parentSessionId, status: "running",
      residency_state: "rpc_detached", execution_mode: "process", pid: 7402,
    }))
    withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_10000019", parent_session_id: "session-other", status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    persistSession(harness.store, ownInProcess.task_id)
    persistSession(harness.store, ownRpc.task_id)

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(harness.launches.map((launch) => launch.taskId).sort()).toEqual([ownInProcess.task_id, ownRpc.task_id])
    expect(result.outcomes.filter((outcome) => outcome.kind === "resumed")).toHaveLength(2)
    expect(harness.store.load("st_10000019")?.residency_state).toBe("persisted_only")
  })

  test("#given terminal no-transcript disposal contends once #when admission follows #then the prompt is never relaunched and disposal defers", async () => {
    // given
    const backing = tempStore()
    const record = withV1(backing, seedRecord(backing, {
      task_id: "st_1000001a", parent_session_id: parentSessionId, status: "completed",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    let mutations = 0
    const store: TaskRecordStore = {
      ...backing,
      mutate: (taskId, mutation) => {
        if (taskId === record.task_id && mutations++ === 0) throw new Error("one-shot disposal lock contention")
        return backing.mutate(taskId, mutation)
      },
    }
    const harness = injectedHarness({ store })

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(harness.launches).toHaveLength(0)
    expect(result.outcomes).toContainEqual({ task_id: record.task_id, kind: "deferred", reason: "lock_contended" })
    expect(harness.store.load(record.task_id)?.residency_state).toBe("persisted_only")
  })

  test("#given model resolution is temporarily unavailable #when revival fails #then ownership rolls back and the outcome is deferred", async () => {
    // given
    const harness = injectedHarness({
      onRespawn: async () => ({
        ok: false, disposition: "retryable", code: "model_unavailable", reason: "model registry is cold",
      }),
    })
    const record = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_10000004", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    persistSession(harness.store, record.task_id)

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(result.outcomes).toContainEqual({ task_id: record.task_id, kind: "deferred", reason: "model_unavailable" })
    expect(harness.store.load(record.task_id)?.residency_state).toBe("persisted_only")
    expect(harness.store.load(record.task_id)?.host_pid).toBeUndefined()
  })

  test("#given retryable respawn failure and rollback lock failure #when reconciled #then the outcome loudly names the failed rollback", async () => {
    // given
    const backing = tempStore()
    const record = withV1(backing, seedRecord(backing, {
      task_id: "st_1000001b", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    persistSession(backing, record.task_id)
    let mutations = 0
    const store: TaskRecordStore = {
      ...backing,
      mutate: (taskId, mutation) => {
        if (taskId === record.task_id && mutations++ === 1) throw new Error("rollback lock failed")
        return backing.mutate(taskId, mutation)
      },
    }
    const harness = injectedHarness({
      store,
      onRespawn: async () => ({
        ok: false, disposition: "retryable", code: "model_unavailable", reason: "model registry is cold",
      }),
    })

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(result.outcomes).toContainEqual({ task_id: record.task_id, kind: "deferred", reason: "rollback_failed" })
    expect(harness.store.load(record.task_id)?.residency_state).toBe("resident")
    expect(harness.store.load(record.task_id)?.host_pid).toBe(hostPid)
  })

  test("#given one record lock throws #when a batch reconciles #then only that record defers and the other revives", async () => {
    // given
    const backing = tempStore()
    const blocked = withV1(backing, seedRecord(backing, {
      task_id: "st_10000005", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    const healthy = withV1(backing, seedRecord(backing, {
      task_id: "st_10000006", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    persistSession(backing, blocked.task_id)
    persistSession(backing, healthy.task_id)
    const store: TaskRecordStore = {
      ...backing,
      mutate: (taskId, mutation) => {
        if (taskId === blocked.task_id) throw new Error("record lock contended")
        return backing.mutate(taskId, mutation)
      },
    }
    const harness = injectedHarness({ store })

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(result.outcomes).toContainEqual({ task_id: blocked.task_id, kind: "deferred", reason: "lock_contended" })
    expect(result.outcomes.find((entry) => entry.task_id === healthy.task_id)?.kind).toBe("resumed")
  })

  test("#given cancelled and killed suspended records #when their session resumes #then neither is revived", async () => {
    // given
    const harness = injectedHarness()
    seedRecord(harness.store, {
      task_id: "st_10000007", parent_session_id: parentSessionId, status: "cancelled",
      residency_state: "persisted_only", execution_mode: "in-process",
    })
    seedRecord(harness.store, {
      task_id: "st_10000008", parent_session_id: parentSessionId, status: "error", killed: true,
      residency_state: "persisted_only", execution_mode: "in-process",
    })

    // when
    await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(harness.launches).toHaveLength(0)
  })

  test("#given a pending child without a transcript and with durable steering #when resumed twice #then it launches once from its prompt and drains steering in order", async () => {
    // given
    const store = tempStore()
    const inProcess = new FakeRunner()
    const manager = createTaskManager({
      store,
      runners: { "in-process": inProcess, process: new FakeRunner() },
      planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
      config: settings(),
      cwd: "/tmp/project",
      hostPid,
    })
    const queue: readonly PendingSteeringEntry[] = [
      { id: "one", message: "first", deliver_as: "steer" },
      { id: "two", message: "second", deliver_as: "followUp" },
    ]
    const seeded = seedRecord(store, {
      task_id: "st_10000009", parent_session_id: parentSessionId, status: "pending",
      residency_state: "persisted_only", execution_mode: "in-process",
    })
    store.replace({ ...withV1(store, seeded, "persisted effective prompt"), pending_steering: queue })
    const lifecycle = createTaskLifecycle({
      store,
      registry: {
        get: (taskId) => manager.getResidentHandle(taskId) === undefined ? undefined : {
          task_id: taskId, kind: "in-process", pid: undefined,
          abort: () => manager.getResidentHandle(taskId)?.abort() ?? Promise.resolve(),
          dispose: () => manager.getResidentHandle(taskId)?.dispose() ?? Promise.resolve(),
          terminate: async () => undefined,
        },
        entries: () => [],
        forget: (taskId) => manager.forget(taskId),
        hasPendingSends: () => false,
      },
      config: settings(), hostPid, now,
    })

    // when
    await lifecycle.reconcileOnSessionStart(parentSessionId)
    await flush()
    await lifecycle.reconcileOnSessionStart(parentSessionId)
    await flush()

    // then
    expect(inProcess.startedSpecs).toHaveLength(1)
    expect(inProcess.startedSpecs[0]?.prompt).toBe("persisted effective prompt")
    expect(inProcess.handles.get(seeded.task_id)?.steerCalls).toEqual(["first"])
    expect(inProcess.handles.get(seeded.task_id)?.followUpCalls).toEqual(["second"])
    expect(store.load(seeded.task_id)?.pending_steering).toBeUndefined()
  })

  test("#given legacy records without transcript or v1 spec #when resumed #then non-terminal is lost and terminal is disposed with its result", async () => {
    // given
    const harness = injectedHarness()
    const running = seedRecord(harness.store, {
      task_id: "st_1000000a", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    })
    const terminal = seedRecord(harness.store, {
      task_id: "st_1000000b", parent_session_id: parentSessionId, status: "completed",
      residency_state: "persisted_only", execution_mode: "in-process",
    })
    harness.store.replace({ ...terminal, final_response: "durable result" })

    // when
    await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(harness.store.load(running.task_id)?.status).toBe("lost")
    expect(harness.store.load(terminal.task_id)?.status).toBe("completed")
    expect(harness.store.load(terminal.task_id)?.final_response).toBe("durable result")
    expect(harness.store.load(terminal.task_id)?.residency_state).toBe("disposed")
  })

  test("#given a terminal v1 record without transcript #when resumed #then it is disposed without rerunning its prompt", async () => {
    // given
    const harness = injectedHarness()
    const record = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_1000000c", parent_session_id: parentSessionId, status: "completed",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    harness.store.replace({ ...record, final_response: "finished" })

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(harness.launches).toHaveLength(0)
    expect(harness.store.load(record.task_id)?.final_response).toBe("finished")
    expect(harness.store.load(record.task_id)?.residency_state).toBe("disposed")
    expect(result.outcomes.find((entry) => entry.task_id === record.task_id)?.reason).toContain("terminal without transcript")
  })

  test("#given an orphaned rpc child still alive #when reclaimed #then the old pid is proven dead before replacement spawn", async () => {
    // given
    const alive = new Set([7331])
    let aliveAtRespawn = true
    const harness = injectedHarness({
      alive,
      onRespawn: async (record) => {
        aliveAtRespawn = alive.has(7331)
        return success(record.task_id)
      },
    })
    const record = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_1000000d", parent_session_id: parentSessionId, status: "running",
      residency_state: "resident", execution_mode: "process", pid: 7331, host_pid: 9999,
    }))
    persistSession(harness.store, record.task_id)

    // when
    await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(harness.signals).toEqual([{ pid: 7331, signal: "SIGTERM" }])
    expect(aliveAtRespawn).toBe(false)
    expect(harness.launches).toHaveLength(1)
  })

  test("#given a killed orphaned resident at the cap #when reconciled #then it is disposed and its slot can be reused", async () => {
    // given
    const harness = injectedHarness({ config: { residency_max_children: 1 } })
    seedRecord(harness.store, {
      task_id: "st_1000000e", parent_session_id: parentSessionId, status: "error", killed: true,
      residency_state: "resident", execution_mode: "in-process", host_pid: 9999,
    })
    const waiting = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_1000000f", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    persistSession(harness.store, waiting.task_id)

    // when
    await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(harness.store.load("st_1000000e")?.residency_state).toBe("disposed")
    expect(harness.store.load(waiting.task_id)?.residency_state).toBe("resident")
  })

  test("#given a same-process orphan and a full cap #when its session resumes #then reclamation bypasses capacity and revives it", async () => {
    // given
    const harness = injectedHarness({ config: { residency_max_children: 1 } })
    const orphan = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_10000010", parent_session_id: parentSessionId, status: "running",
      residency_state: "resident", execution_mode: "in-process", host_pid: hostPid,
    }))
    persistSession(harness.store, orphan.task_id)

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(result.outcomes.find((entry) => entry.task_id === orphan.task_id)?.kind).toBe("resumed")
    expect(harness.launches).toHaveLength(1)
  })

  test("#given two OS processes observe one dead-owner resident #when their ownership CAS races #then exactly one respawns and the loser defers", async () => {
    // given: both workers take their store snapshot before either is released to mutate.
    const harness = injectedHarness()
    const orphan = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_10000014", parent_session_id: parentSessionId, status: "running",
      residency_state: "resident", execution_mode: "in-process", host_pid: 2_147_483_647,
      updated_at: new Date(1_000_000).toISOString(),
    }))
    persistSession(harness.store, orphan.task_id)
    const launchLog = join(harness.store.stateDir, "race-launches.log")
    const children = ["a", "b"].map(() => Bun.spawn(
      [process.execPath, raceWorkerPath, harness.store.stateDir, parentSessionId, launchLog],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    ))
    const readers = children.map((child) => lineReader(child.stdout))
    const errors = children.map((child) => new Response(child.stderr).text())

    // when: subscribe to both exact scanned signals, then release both CAS attempts.
    await Promise.all(readers.map((read) => withTimeout(read(), 10_000, "worker scan barrier")))
    for (const child of children) {
      child.stdin.write("g")
      child.stdin.flush()
    }
    const results = await Promise.all(readers.map(async (read) => {
      const line = await withTimeout(read(), 10_000, "worker reconcile result")
      return JSON.parse(line) as { readonly outcomes: readonly { readonly kind: string; readonly reason?: string }[] }
    }))

    for (const child of children) {
      child.stdin.write("x")
      child.stdin.end()
    }
    const exits = await Promise.all(children.map((child) => child.exited))
    const stderr = await Promise.all(errors)

    // then
    const launches = readFileSync(launchLog, "utf8").trim().split("\n").filter(Boolean)
    expect(launches).toHaveLength(1)
    expect(results.flatMap((result) => result.outcomes).map((outcome) => `${outcome.kind}:${outcome.reason}`).sort())
      .toEqual(["deferred:foreign_live_owner", "resumed:respawned and reattached"])
    exits.forEach((code, index) => expect(code, stderr[index]).toBe(0))
  }, 20_000)

  test("#given reattach and child resume are disabled #when suspended records exist #then they remain suspended with deferred outcomes", async () => {
    // given
    const disabledReattach = injectedHarness({ config: { reattach_on_reconcile: false } })
    const first = withV1(disabledReattach.store, seedRecord(disabledReattach.store, {
      task_id: "st_10000011", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    const disabledResume = injectedHarness({ config: { resume_children: false } })
    const second = withV1(disabledResume.store, seedRecord(disabledResume.store, {
      task_id: "st_10000012", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))

    // when
    const reattachResult = await disabledReattach.lifecycle.reconcileOnSessionStart(parentSessionId)
    await disabledResume.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(reattachResult.outcomes).toContainEqual({ task_id: first.task_id, kind: "deferred", reason: "reattach_disabled" })
    expect(disabledReattach.store.load(first.task_id)?.residency_state).toBe("persisted_only")
    expect(disabledResume.store.load(second.task_id)?.residency_state).toBe("persisted_only")
    expect(disabledResume.launches).toHaveLength(0)
  })

  test("#given ten suspended children and capacity eight #when resumed #then eight revive and overflow defers without loss", async () => {
    // given
    const harness = injectedHarness({ config: { residency_max_children: 8 } })
    for (let index = 0; index < 10; index += 1) {
      const id = `st_100001${index.toString().padStart(2, "0")}`
      const record = withV1(harness.store, seedRecord(harness.store, {
        task_id: id, parent_session_id: parentSessionId, status: "running",
        residency_state: "persisted_only", execution_mode: "in-process",
      }))
      persistSession(harness.store, record.task_id)
    }

    // when
    const result = await harness.lifecycle.reconcileOnSessionStart(parentSessionId)

    // then
    expect(harness.launches).toHaveLength(8)
    expect(result.outcomes.filter((entry) => entry.kind === "deferred" && entry.reason === "capacity")).toHaveLength(2)
    expect(harness.store.list().records.filter((record) => record.status === "lost")).toHaveLength(0)
  })

  test("#given the admission lease is held past the bounded wait #when the session resumes #then the batch defers without throwing", async () => {
    // given
    const harness = injectedHarness()
    const record = withV1(harness.store, seedRecord(harness.store, {
      task_id: "st_10000013", parent_session_id: parentSessionId, status: "running",
      residency_state: "persisted_only", execution_mode: "in-process",
    }))
    const held = await acquireSessionAdmissionLease(harness.store.stateDir, parentSessionId, {
      renewMs: 10, staleMs: 100, acquireTimeoutMs: 20, retryMs: 2,
    })
    if (held.kind !== "acquired") throw new Error("expected held admission lease")
    const contended = createTaskLifecycle({
      store: harness.store,
      registry: new FakeRegistry(),
      config: settings(), hostPid, now,
      reconcileAdmission: { timing: { acquireTimeoutMs: 20, retryMs: 2 } },
      respawn: async (fresh) => success(fresh.task_id),
      reattach: async () => ({ ok: true }),
    })

    // when
    const result = await contended.reconcileOnSessionStart(parentSessionId)
    held.lease.release()

    // then
    expect(result.outcomes).toContainEqual({ task_id: record.task_id, kind: "deferred", reason: "lock_contended" })
  })
})

function lineReader(stream: ReadableStream<Uint8Array>): () => Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  return async () => {
    for (;;) {
      const newline = buffered.indexOf("\n")
      if (newline >= 0) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        return line
      }
      const next = await reader.read()
      if (next.done) throw new Error("worker stdout ended before the expected line")
      buffered += decoder.decode(next.value, { stream: true })
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
