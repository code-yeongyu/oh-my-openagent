import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects as cleanupManagers, FakeRunner } from "../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../manager/manager"
import { AdmissionBarrier } from "../pause/admission-barrier"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { createTaskLifecycle } from "./create"
import { NO_HOST_ENDPOINT } from "./host-session"
import { cleanupProjects, FakeRegistry, readEvents, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"
import { liveParentFixture } from "./__fixtures__/live-parent-fakes"

const fixtures: ReturnType<typeof liveParentFixture>[] = []
afterEach(() => {
  for (const f of fixtures.splice(0)) f.dispose()
  cleanupProjects()
  cleanupManagers()
})

const now = () => 5_000_000

describe("revival of a child whose run is stopped", () => {
  test("#given a dead process child with a transcript #when startup reconciles it under a stopped run #then it is deferred, never lost", async () => {
    const store = tempStore()
    const taskId = "st_0000a0b1"
    const seeded = seedRecord(store, {
      task_id: taskId, status: "running", residency_state: "resident", execution_mode: "process", pid: 900,
      updated_at: new Date(now() - 1_000).toISOString(),
    })
    store.replace({ ...seeded, spawn_spec: { cwd: "/tmp/project", extensions: [], member_env: {} } })
    const sessions = resolveChildSessionDir(join(store.stateDir, "children", taskId), taskId)
    mkdirSync(sessions, { recursive: true })
    writeFileSync(join(sessions, "2026-10-21_child.jsonl"), "{}\n")
    const barrier = new AdmissionBarrier()
    createTaskManager({
      store, admissionBarrier: barrier, cwd: "/tmp/project",
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }),
      config: settings({ default_concurrency: 5 }),
      rpcRespawnRunner: { start: async () => { throw new Error("a stopped run must never launch its child") } },
    })
    barrier.close(seeded.root_session_id ?? seeded.parent_session_id, 2)
    const lifecycle = createTaskLifecycle({
      hostEndpoint: NO_HOST_ENDPOINT, store, registry: new FakeRegistry(), config: settings(), now,
      signaller: { isAlive: () => false, signal: () => undefined }, orphanKillDelayMs: 0,
    })
    const result = await lifecycle.reconcileOnSessionStart()
    expect(result.outcomes.find(outcome => outcome.task_id === taskId)).toMatchObject({ kind: "deferred", reason: "run_paused" })
    expect(store.load(taskId)?.status).toBe("running")
    expect(readEvents(store, taskId)).not.toContain("reconcile_lost")
  })

  test("#given a live parent whose suspended child's run is stopped #when the suspension budget passes #then the child is not ended", async () => {
    const f = liveParentFixture()
    fixtures.push(f)
    const id = await f.start()
    f.state.failureCode = "run_paused"
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await attempted
    const retried = f.wait("live_parent_recovery_attempt")
    f.advance(300_000)
    await retried
    const record = f.store.load(id)
    expect(record?.status).toBe("running")
    expect(record?.failure_kind).toBeUndefined()
    expect(f.messages).toHaveLength(0)
  })
})
