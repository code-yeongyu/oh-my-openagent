import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import type { ProcessSignaller, RespawnResult } from "./port"
import {
  cleanupProjects,
  fakeHandle,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
} from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const parentSessionId = "resumed-session"
const now = () => 100_000_000

function iso(ageMs: number): string {
  return new Date(now() - ageMs).toISOString()
}

function transcript(store: TaskRecordStore, taskId: string): string {
  const directory = join(store.stateDir, "children", taskId, "sessions", taskId)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, "resume.jsonl")
  writeFileSync(path, "{\"role\":\"assistant\"}\n")
  return path
}

function success(taskId: string): RespawnResult {
  return {
    ok: true,
    handle: {
      task_id: taskId,
      sessionId: `session:${taskId}`,
      pid: 7000,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      subscribe: () => () => undefined,
      waitForOutcome: () => new Promise(() => undefined),
      lastAssistantText: () => undefined,
      dispose: async () => undefined,
    },
  }
}

function lifecycleFor(
  store: TaskRecordStore,
  launches: string[],
  alive: Set<number> = new Set(),
  overrides: Record<string, unknown> = {},
) {
  const signals: Array<{ readonly pid: number; readonly signal: string }> = []
  const signaller: ProcessSignaller = {
    isAlive: (pid) => alive.has(pid),
    signal: (pid, signal) => {
      signals.push({ pid, signal })
      alive.delete(pid)
    },
  }
  const lifecycle = createTaskLifecycle({
    store,
    registry: new FakeRegistry(),
    config: settings(overrides),
    now,
    hostPid: 6000,
    signaller,
    orphanKillDelayMs: 0,
    respawn: async (record) => {
      launches.push(record.task_id)
      return success(record.task_id)
    },
    reattach: async () => ({ ok: true }),
  })
  return { lifecycle, signals }
}

function terminalResident(store: TaskRecordStore, taskId: string, status: "completed" | "error" = "completed"): TaskRecord {
  const record = seedRecord(store, {
    task_id: taskId,
    status,
    residency_state: "resident",
    execution_mode: "process",
    pid: 9000,
    updated_at: iso(1000),
  })
  const completed = {
    ...record,
    final_response: "durable result",
    terminal_at: iso(50_000),
  }
  store.replace(completed)
  transcript(store, taskId)
  return completed
}

describe("terminal resident reconciliation", () => {
  test("#given a handle appears during terminal pid termination #when legacy reconciliation finishes #then the resident record is not detached", async () => {
    const store = tempStore()
    const original = terminalResident(store, "st_75500000")
    const registry = new FakeRegistry()
    const signals: Array<{ readonly pid: number; readonly signal: string }> = []
    const alive = new Set([9000])
    const handle = fakeHandle(original.task_id, "rpc", [], { pid: 7000 })
    const signaller: ProcessSignaller = {
      isAlive: (pid) => alive.has(pid),
      signal: (pid, signal) => {
        signals.push({ pid, signal })
        alive.delete(pid)
        store.replace({
          ...store.load(original.task_id)!,
          status: "running",
          residency_state: "resident",
          host_pid: 6000,
          updated_at: new Date(now()).toISOString(),
        })
        registry.add(handle)
      },
    }
    const lifecycle = createTaskLifecycle({
      store,
      registry,
      config: settings(),
      now,
      hostPid: 6000,
      signaller,
      orphanKillDelayMs: 0,
    })

    const result = await lifecycle.reconcileOnSessionStart()

    expect(result.outcomes).toContainEqual({
      task_id: original.task_id,
      kind: "deferred",
      reason: "foreign_live_owner",
    })
    expect(signals).toEqual([{ pid: 9000, signal: "SIGTERM" }])
    expect(store.load(original.task_id)?.residency_state).toBe("resident")
    expect(store.load(original.task_id)?.status).toBe("running")
    expect(registry.get(original.task_id)).toBe(handle)
    lifecycle.dispose?.()
  })

  test("#given a terminal resident with no transcript #when the legacy sweep reconciles #then it disposes and preserves the persisted result", async () => {
    const store = tempStore()
    const original = seedRecord(store, {
      task_id: "st_75500000",
      status: "completed",
      residency_state: "resident",
      execution_mode: "process",
      pid: 9000,
    })
    store.replace({ ...original, final_response: "durable result" })
    const launches: string[] = []
    const { lifecycle } = lifecycleFor(store, launches)

    const result = await lifecycle.reconcileOnSessionStart()

    expect(launches).toEqual([])
    expect(result.outcomes).toContainEqual({
      task_id: original.task_id,
      kind: "resumed",
      reason: "terminal without transcript disposed; persisted result preserved",
    })
    expect(store.load(original.task_id)).toMatchObject({
      residency_state: "disposed",
      final_response: "durable result",
    })
  })

  test("#given a completed resident with a transcript and dead pid #when session start reconciles #then it detaches without respawn and preserves output", async () => {
    const store = tempStore()
    const original = terminalResident(store, "st_75500001")
    const launches: string[] = []
    const { lifecycle } = lifecycleFor(store, launches)

    const result = await lifecycle.reconcileOnSessionStart()

    expect(launches).toEqual([])
    expect(result.outcomes).toContainEqual({
      task_id: original.task_id,
      kind: "resumed",
      reason: "terminal resident detached",
    })
    const detached = store.load(original.task_id)
    expect(detached?.status).toBe("completed")
    expect(detached?.residency_state).toBe("rpc_detached")
    expect(detached?.final_response).toBe("durable result")
    expect(detached?.terminal_at).toBe(original.terminal_at)
  })

  test("#given a completed resident with a live orphan pid #when session start reconciles #then it terminates and detaches without respawn", async () => {
    const store = tempStore()
    const original = terminalResident(store, "st_75500002")
    const launches: string[] = []
    const { lifecycle, signals } = lifecycleFor(store, launches, new Set([9000]))

    await lifecycle.reconcileOnSessionStart()

    expect(signals).toEqual([{ pid: 9000, signal: "SIGTERM" }])
    expect(launches).toEqual([])
    expect(store.load(original.task_id)?.residency_state).toBe("rpc_detached")
    expect(store.load(original.task_id)?.status).toBe("completed")
  })
})

describe("scoped terminal revival", () => {
  test("#given suspended completed and error records with transcripts #when their session resumes #then neither is respawned", async () => {
    const store = tempStore()
    for (const [taskId, status] of [["st_75500003", "completed"], ["st_75500004", "error"]] as const) {
      const record = seedRecord(store, {
        task_id: taskId,
        parent_session_id: parentSessionId,
        status,
        residency_state: "rpc_detached",
        execution_mode: "process",
      })
      store.replace({ ...record, final_response: "saved" })
      transcript(store, taskId)
    }
    const launches: string[] = []
    const { lifecycle } = lifecycleFor(store, launches)

    await lifecycle.reconcileOnSessionStart(parentSessionId)

    expect(launches).toEqual([])
    expect(store.list().records.every((record) => record.residency_state === "rpc_detached")).toBe(true)
  })

  test("#given suspended running and interrupted records with transcripts #when their session resumes #then both still respawn", async () => {
    const store = tempStore()
    for (const [taskId, status] of [["st_75500005", "running"], ["st_75500006", "interrupted"]] as const) {
      const record = seedRecord(store, {
        task_id: taskId,
        parent_session_id: parentSessionId,
        status,
        residency_state: "rpc_detached",
        execution_mode: "process",
      })
      store.replace({ ...record, spawn_spec: { cwd: "/tmp/project" } })
      transcript(store, taskId)
    }
    const launches: string[] = []
    const { lifecycle } = lifecycleFor(store, launches)

    await lifecycle.reconcileOnSessionStart(parentSessionId)

    expect(launches.sort()).toEqual(["st_75500005", "st_75500006"])
  })
})

describe("terminal TTL anchor", () => {
  test("#given a legacy terminal resident older than ttl without terminal_at #when reconcile then cleanup runs #then parse-time updated_at anchor expires it", async () => {
    const store = tempStore()
    const original = terminalResident(store, "st_75500009")
    const path = join(store.stateDir, "tasks", `${original.task_id}.json`)
    const legacy = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    delete legacy.terminal_at
    legacy.updated_at = iso(50_000)
    writeFileSync(path, JSON.stringify(legacy))
    const launches: string[] = []
    const { lifecycle } = lifecycleFor(store, launches, new Set(), { ttl_ms: 10_000 })

    await lifecycle.reconcileOnSessionStart()
    const parsed = store.load(original.task_id)
    expect(parsed?.terminal_at).toBe(iso(50_000))
    const cleanup = await lifecycle.cleanupExpiredRecords()

    expect(cleanup.deleted).toContain(original.task_id)
  })

  test("#given a terminal resident older than ttl #when reconcile then cleanup runs #then terminal_at expires it despite a refreshed updated_at", async () => {
    const store = tempStore()
    const original = terminalResident(store, "st_75500007")
    const launches: string[] = []
    const { lifecycle } = lifecycleFor(store, launches, new Set(), { ttl_ms: 10_000 })

    await lifecycle.reconcileOnSessionStart()
    const refreshed = store.load(original.task_id)
    expect(refreshed?.updated_at).not.toBe(original.updated_at)
    expect(refreshed?.terminal_at).toBe(original.terminal_at)
    const cleanup = await lifecycle.cleanupExpiredRecords()

    expect(cleanup.deleted).toContain(original.task_id)
  })
})
