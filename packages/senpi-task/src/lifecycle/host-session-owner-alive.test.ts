import { afterEach, describe, expect, test } from "bun:test"

import type { RespawnResult } from "./port"
import { createTaskLifecycle } from "./create"
import { hostLifecycleDeps, hostSession, hostSessionRecordInput } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

// The daemon worker a child session runs in, and the parent process that owns the task.
const DAEMON_WORKER_PID = 92_352
const PARENT_PID = 92_183

const REATTACHED: RespawnResult = {
  ok: true,
  handle: {
    task_id: "st_0c000001",
    sessionId: "stolen",
    pid: undefined,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => undefined,
    waitForOutcome: () => new Promise(() => undefined),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  },
}

// The 2026-09-26 hang: the parent's child failed on its first model, the parent closed that session
// and opened the next rung's. The new child session starts INSIDE the daemon, and its omo extension
// reconciles the shared project records while the parent's record still names the closed session.
describe("a resident host-session record whose session is between rungs", () => {
  test("#given the owning parent process is alive #when another session's reconcile sweeps #then it is deferred and never reattached", async () => {
    const store = tempStore()
    const closedRung = hostSession("st_0c000001")
    const fixture = hostLifecycleDeps({
      store,
      hostPid: DAEMON_WORKER_PID,
      isAlive: (pid) => pid === PARENT_PID,
      respawn: () => Promise.resolve(REATTACHED),
    })
    seedRecord(store, {
      ...hostSessionRecordInput("st_0c000001", closedRung),
      parent_session_id: "parent-session",
      status: "running",
      residency_state: "resident",
      host_pid: PARENT_PID,
    })
    const lifecycle = createTaskLifecycle(fixture.deps)

    const result = await lifecycle.reconcileOnSessionStart("child-session-of-next-rung")

    expect(result.outcomes).toContainEqual({ task_id: "st_0c000001", kind: "deferred", reason: "foreign_live_owner" })
    expect(fixture.respawned).toEqual([])
    const record = store.load("st_0c000001")
    expect(record?.host_pid).toBe(PARENT_PID)
    expect(record?.notification.run_epoch).toBe(0)
  })

  test("#given the owning process is gone #when another session's reconcile sweeps #then the orphan is still reclaimed", async () => {
    const store = tempStore()
    const closedRung = hostSession("st_0c000002")
    const fixture = hostLifecycleDeps({
      store,
      hostPid: DAEMON_WORKER_PID,
      isAlive: () => false,
      respawn: () => Promise.resolve({ ...REATTACHED, handle: { ...REATTACHED.handle, task_id: "st_0c000002" } } as RespawnResult),
    })
    seedRecord(store, {
      ...hostSessionRecordInput("st_0c000002", closedRung),
      parent_session_id: "parent-session",
      status: "running",
      residency_state: "resident",
      host_pid: PARENT_PID,
    })
    const lifecycle = createTaskLifecycle(fixture.deps)

    const result = await lifecycle.reconcileOnSessionStart("child-session-of-next-rung")

    expect(result.outcomes.some((outcome) => outcome.task_id === "st_0c000002" && outcome.reason === "foreign_live_owner")).toBe(false)
  })
})
