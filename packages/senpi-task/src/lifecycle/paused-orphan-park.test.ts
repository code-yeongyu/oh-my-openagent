import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { ManagedChildHandle } from "../manager/child-handle"
import { restorePausedChild } from "../manager/paused-restore"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { createTaskLifecycle } from "./create"
import { NO_HOST_ENDPOINT } from "./host-session"
import { NO_START_EVIDENCE } from "./owner-process"
import { cleanupProjects, FakeRegistry, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const RUN_OWNER = {
  parent_session_id: "s1",
  parent_pause_seq: 3,
  run_ref: { kind: "task" as const, id: "st_3a000001" },
}

function pausedOrphan(withTranscript: boolean) {
  const store = tempStore()
  const seeded = seedRecord(store, {
    task_id: "st_3a000001",
    parent_session_id: "s1",
    status: "running",
    residency_state: "resident",
    execution_mode: "in-process",
    host_pid: 7777,
  })
  store.replace({ ...seeded, spawn_spec: { version: 1, cwd: "/tmp", prompt: "p" }, run_pause: RUN_OWNER })
  store.transition(seeded.task_id, { type: "pause", timestamp: new Date(1).toISOString() })
  if (withTranscript) {
    const dir = resolveChildSessionDir(join(store.stateDir, "children", seeded.task_id), seeded.task_id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "session.jsonl"), "{}\n")
  }
  const lifecycle = createTaskLifecycle({
    hostEndpoint: NO_HOST_ENDPOINT,
    store,
    registry: new FakeRegistry(),
    config: settings(),
    hostPid: 2222,
    now: () => 9_000_000,
    signaller: { isAlive: () => false, signal: () => undefined },
    orphanKillDelayMs: 0,
    respawn: async () => ({ ok: false, disposition: "retryable", code: "run_paused", reason: "held" }),
    reattach: async () => ({ ok: true }),
  })
  return { store, lifecycle, taskId: seeded.task_id }
}

// The owning process died while its run held this child paused (a parent restart). Disposing it
// threw away work the run's own Resume would have restored from the transcript (omo#12080).
describe("a paused child whose owner process is gone", () => {
  test("#given a transcript #when session start reconciles #then it stays paused with its run owner, parked for the run's Resume", async () => {
    // given
    const h = pausedOrphan(true)

    // when
    const result = await h.lifecycle.reconcileOnSessionStart("s1")

    // then
    expect(result.outcomes.find((entry) => entry.task_id === h.taskId)).toMatchObject({
      kind: "deferred",
      reason: "run_paused",
    })
    const parked = h.store.load(h.taskId)
    expect(parked).toMatchObject({ status: "paused", residency_state: "persisted_only", run_pause: RUN_OWNER })
    expect(parked?.killed).not.toBe(true)
    expect(parked?.host_pid).toBeUndefined()
  })

  test("#given no transcript to restore from #when session start reconciles #then it is disposed as before", async () => {
    // given
    const h = pausedOrphan(false)

    // when
    await h.lifecycle.reconcileOnSessionStart("s1")

    // then
    expect(h.store.load(h.taskId)?.residency_state).toBe("disposed")
  })

  // The startup sweep also visits other sessions' children (and the unscoped sweep visits all of them). Marking such a
  // paused orphan lost made its run's recovered DAG treat it as failed instead of restoring it on Resume.
  for (const sweep of [{ name: "another session's start", session: "s2" }, { name: "the unscoped sweep" }]) {
    test(`#given a transcript #when ${sweep.name} reconciles #then it is parked for its run, and the run's Resume restores it`, async () => {
      // given
      const h = pausedOrphan(true)

      // when
      const result = await h.lifecycle.reconcileOnSessionStart(sweep.session)

      // then
      expect(result.outcomes.find((entry) => entry.task_id === h.taskId)).toMatchObject({
        kind: "deferred",
        reason: "run_paused",
      })
      const parked = h.store.load(h.taskId)
      expect(parked).toMatchObject({ status: "paused", residency_state: "persisted_only", run_pause: RUN_OWNER })
      if (parked === null) throw new Error("record vanished")

      // when
      const handle = { task_id: h.taskId } as ManagedChildHandle
      const restored = await restorePausedChild(
        {
          store: h.store,
          hostPid: 3333,
          isProcessAlive: () => false,
          ownerProcesses: NO_START_EVIDENCE,
          respawn: async () => ({ ok: true, handle }),
          reattach: async () => ({ ok: true }),
          liveHandle: () => handle,
        },
        parked,
      )

      // then
      expect(restored).toBe(handle)
      expect(h.store.load(h.taskId)).toMatchObject({ status: "paused", residency_state: "resident", host_pid: 3333 })
    })
  }
})
