import { afterEach, describe, expect, test } from "bun:test"

import type { HostSessionIdentity, TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import { HOST_SOCKET, hostLifecycleDeps, hostSession } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"

// A parent that dies after committing the handoff but before its failed rung finished closing leaves
// that rung's child with no owner but the record. Revival must end it before launching the next rung,
// or the task is left with a retained daemon session (or a live process) that nothing ever closes.

afterEach(cleanupProjects)

const DEAD_OWNER = 11_001
const SWEEPER = 22_002

function seedClosingHandoff(store: TaskRecordStore, taskId: string, closing: TaskRecord["fallback_closing_child"]): void {
  seedRecord(store, {
    task_id: taskId,
    status: "running",
    execution_mode: "process",
    host_pid: DEAD_OWNER,
    run_epoch: 1,
    spawn_spec: { version: 1, cwd: "/tmp", prompt: "do the original task" },
  })
  store.mutate(taskId, (record) => ({ ...record, model: "test/next", fallback_handoff_epoch: 1, ...(closing === undefined ? {} : { fallback_closing_child: closing }) }))
}

function sweeper(store: TaskRecordStore, alive: Set<number>) {
  const signals: string[] = []
  const launched: string[] = []
  const ports = hostLifecycleDeps({
    store,
    hostPid: SWEEPER,
    signals,
    isAlive: (pid) => pid === SWEEPER || alive.has(pid),
    respawn: async (record) => {
      launched.push(record.task_id)
      return { ok: false, disposition: "retryable", code: "respawn_failed", reason: "launch observed" }
    },
  })
  const lifecycle = createTaskLifecycle({
    ...ports.deps,
    signaller: {
      isAlive: (pid) => pid === SWEEPER || alive.has(pid),
      signal: (pid, signal) => {
        signals.push(`${signal}:${pid}`)
        alive.delete(pid)
      },
    },
  })
  return { ports, lifecycle, signals, launched }
}

describe("revival of a handoff whose owner died before the failed rung closed", () => {
  test("#given the failed rung's daemon session is still retained #when another session revives the handoff #then that session is closed before the next rung launches", async () => {
    // given
    const store = tempStore()
    const closingSession: HostSessionIdentity = hostSession("st_0000c001", { session_path: "/tmp/dh-fake/sessions/failed-rung.jsonl" })
    seedClosingHandoff(store, "st_0000c001", { host_session: closingSession })
    const s = sweeper(store, new Set())
    s.ports.daemon.hold(closingSession.session_path)

    // when
    await s.lifecycle.reconcileOnSessionStart("other-session")

    // then
    expect(s.ports.daemon.closed).toEqual([closingSession.session_path])
    expect(s.launched).toEqual(["st_0000c001"])
    expect(store.load("st_0000c001")?.fallback_closing_child).toBeUndefined()
    s.lifecycle.dispose?.()
  })

  test("#given the failed rung's process is still alive #when the handoff is revived #then the process is signalled before the next rung launches", async () => {
    // given
    const store = tempStore()
    seedClosingHandoff(store, "st_0000c002", { pid: 5_150 })
    const s = sweeper(store, new Set([5_150]))

    // when
    await s.lifecycle.reconcileOnSessionStart("other-session")

    // then
    expect(s.signals).toEqual(["SIGTERM:5150"])
    expect(s.launched).toEqual(["st_0000c002"])
    s.lifecycle.dispose?.()
  })

  test("#given the daemon refuses to close the failed rung's session #when the handoff is revived #then the next rung is not launched beside it", async () => {
    // given
    const store = tempStore()
    const closingSession = hostSession("st_0000c003", { session_path: "/tmp/dh-fake/sessions/refusing.jsonl" })
    seedClosingHandoff(store, "st_0000c003", { host_session: closingSession })
    const s = sweeper(store, new Set())
    s.ports.daemon.hold(closingSession.session_path)
    s.ports.daemon.close = () => Promise.reject(new Error("close refused"))

    // when
    const result = await s.lifecycle.reconcileOnSessionStart("other-session")

    // then
    expect(result.outcomes).toContainEqual(expect.objectContaining({ task_id: "st_0000c003", kind: "deferred" }))
    expect(s.launched).toEqual([])
    expect(store.load("st_0000c003")?.fallback_closing_child?.host_session?.socket).toBe(HOST_SOCKET)
    s.lifecycle.dispose?.()
  })
})
