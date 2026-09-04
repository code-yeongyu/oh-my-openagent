import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { ManagedChildHandle } from "../manager/child-handle"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import type { TaskRecord } from "../state"
import { createTaskLifecycle } from "./create"
import {
  cleanupProjects,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
} from "./__fixtures__/lifecycle-fakes"

const parentSessionId = "session-capacity"

function handle(taskId: string): ManagedChildHandle {
  return {
    task_id: taskId,
    sessionId: `session:${taskId}`,
    pid: undefined,
    steer: async () => undefined,
    followUp: async () => undefined,
    abort: async () => undefined,
    subscribe: () => () => undefined,
    waitForOutcome: () => new Promise(() => undefined),
    lastAssistantText: () => undefined,
    dispose: async () => undefined,
  }
}

function harness(options: { readonly reservationOk: boolean; readonly legacy: boolean }) {
  const store = tempStore()
  const record = seedRecord(store, options.legacy
    ? {
        task_id: "st_20000001",
        parent_session_id: "legacy-session",
        status: "completed",
        residency_state: "resident",
        execution_mode: "process",
        pid: 900,
        host_pid: 999,
      }
    : {
        task_id: "st_20000002",
        parent_session_id: parentSessionId,
        status: "running",
        residency_state: "persisted_only",
        execution_mode: "in-process",
      })
  if (options.legacy) {
    const directory = resolveChildSessionDir(join(store.stateDir, "children", record.task_id), record.task_id)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, "resume.jsonl"), "{}\n")
  } else {
    const withSpawnSpec: TaskRecord = {
      ...record,
      spawn_spec: { version: 1, cwd: "/tmp/project", prompt: "resume" },
    }
    store.replace(withSpawnSpec)
  }
  const calls: string[] = []
  const lifecycle = createTaskLifecycle({
    store,
    registry: new FakeRegistry(),
    config: settings(),
    hostPid: 222,
    signaller: { isAlive: () => false, signal: () => undefined },
    reserveReattach: (candidate) => {
      calls.push(`reserve:${candidate.task_id}`)
      return options.reservationOk
        ? { ok: true, release: () => calls.push(`release:${candidate.task_id}`) }
        : { ok: false }
    },
    respawn: async (candidate) => {
      calls.push(`respawn:${candidate.task_id}`)
      return { ok: true, handle: handle(candidate.task_id) }
    },
    reattach: async (candidate) => {
      calls.push(`reattach:${candidate.task_id}`)
      return { ok: true }
    },
  })
  return { lifecycle, record, calls }
}

afterEach(cleanupProjects)

describe("reconcile capacity reservations", () => {
  test("#given a terminal legacy resident at cap #when reconciled #then it detaches without consulting reattach capacity", async () => {
    const { lifecycle, record, calls } = harness({ reservationOk: false, legacy: true })

    const result = await lifecycle.reconcileOnSessionStart()

    expect(result.outcomes).toContainEqual({ task_id: record.task_id, kind: "resumed", reason: "terminal resident detached" })
    expect(calls).toEqual([])
  })

  test("#given reclamation reconcile is at cap #when revival is considered #then it rolls back and defers without respawn", async () => {
    const { lifecycle, record, calls } = harness({ reservationOk: false, legacy: false })

    const result = await lifecycle.reconcileOnSessionStart(parentSessionId)

    expect(result.outcomes).toContainEqual({ task_id: record.task_id, kind: "deferred", reason: "capacity" })
    expect(calls).toEqual([`reserve:${record.task_id}`])
  })
})
