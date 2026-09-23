import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { resolveContext } from "./context"
import { createTaskLifecycle } from "./create"
import { getLifecycleDetachedRevival, type ProcessSignaller, type RespawnResult } from "./port"
import { needsCrashSalvage } from "../isolation"
import { reviveClaimed } from "./reconcile-reclamation"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import type { TaskIsolationSpec, TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { FakeRegistry, cleanupProjects, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const hostPid = 4242
const now = () => 9_000_000

const isolationSpec: TaskIsolationSpec = {
  backend: "rcopy",
  merged_dir: "/tmp/does-not-matter/m",
  base_dir: "/tmp/does-not-matter",
  mode: "patch",
  apply: true,
}

function persistSession(store: TaskRecordStore, taskId: string): string {
  const directory = resolveChildSessionDir(join(store.stateDir, "children", taskId), taskId)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, "resume.jsonl")
  writeFileSync(path, "{}\n")
  utimesSync(path, new Date(2_000), new Date(2_000))
  return path
}

function isolatedRecord(store: TaskRecordStore, input: Parameters<typeof seedRecord>[1]): TaskRecord {
  const seeded = seedRecord(store, input)
  const record: TaskRecord = {
    ...seeded,
    isolation: isolationSpec,
    spawn_spec: { version: 1, cwd: isolationSpec.merged_dir, prompt: `prompt:${seeded.task_id}`, isolation: isolationSpec },
  }
  store.replace(record)
  return record
}

function harness(options: { readonly alive?: Set<number> } = {}) {
  const store = tempStore()
  const registry = new FakeRegistry()
  const respawns: string[] = []
  const alive = options.alive ?? new Set<number>()
  const signaller: ProcessSignaller = {
    isAlive: (pid) => alive.has(pid),
    signal: (pid) => { alive.delete(pid) },
  }
  const lifecycle = createTaskLifecycle({
    store,
    registry,
    config: settings(),
    hostPid,
    now,
    signaller,
    orphanKillDelayMs: 0,
    respawn: async (record): Promise<RespawnResult> => {
      respawns.push(record.task_id)
      return { ok: false, disposition: "unrecoverable", code: "spawn_spec_unavailable", reason: "respawn must never run for an isolated record" }
    },
    reattach: async () => ({ ok: true }),
  })
  return { store, registry, respawns, lifecycle, signaller }
}

describe("isolated records are never revived", () => {
  test("#given an isolated parked child #when task_send tries the detached revival #then it is refused without touching the admission lease", async () => {
    const { store, lifecycle } = harness()
    expect(lifecycle).toBeDefined()
    const record = isolatedRecord(store, {
      task_id: "st_20000001", status: "completed", residency_state: "persisted_only", host_pid: hostPid,
    })
    persistSession(store, record.task_id)

    const revive = getLifecycleDetachedRevival(store)
    expect(revive).toBeDefined()
    const outcome = await revive?.(record.task_id, { commit: () => undefined, release: () => undefined })

    expect(outcome).toEqual({ ok: false, code: "admission_refused", reason: "isolated_not_revivable" })
  })

  test("#given an isolated claimed record #when reviveClaimed runs #then it is marked lost so its delta is salvageable, never respawned", async () => {
    const { store, registry, respawns, signaller } = harness()
    const record = isolatedRecord(store, {
      task_id: "st_20000002", status: "running", residency_state: "resident", host_pid: hostPid,
    })
    const context = resolveContext({
      store, registry, config: settings(), hostPid, now, signaller, orphanKillDelayMs: 0,
    })

    const outcome = await reviveClaimed(context, record, "persisted_only", persistSession(store, record.task_id))

    expect(outcome).toEqual({ task_id: record.task_id, kind: "lost", reason: "isolated_not_revivable" })
    expect(respawns).toEqual([])
    // Deferring instead left the record non-terminal, and crash salvage only looks at terminal
    // records - so the sweep in the same pass reclaimed the clone with the child's delta in it.
    const reloaded = store.load(record.task_id)
    if (reloaded === null) throw new Error("the record vanished")
    expect(reloaded.status).toBe("lost")
    expect(needsCrashSalvage(reloaded, (candidate) => candidate.status === "lost")).toBe(true)
  })

  test("#given an isolated legacy process record with a transcript #when startup reconcile runs #then it is marked lost and never respawned", async () => {
    const { store, respawns, lifecycle } = harness()
    const record = isolatedRecord(store, {
      task_id: "st_20000003", parent_session_id: "session-other", status: "running",
      residency_state: "resident", execution_mode: "process", pid: 7401, host_pid: 9999,
    })
    persistSession(store, record.task_id)

    const result = await lifecycle.reconcileOnSessionStart("session-resumed")

    expect(respawns).toEqual([])
    expect(result.outcomes).toContainEqual({
      task_id: record.task_id, kind: "lost", reason: "isolated_not_revivable",
    })
    expect(store.load(record.task_id)?.status).toBe("lost")
  })
})
