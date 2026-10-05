import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "./create"
import {
  hostLifecycleDeps,
  hostSession,
  hostSessionHandle,
  hostSessionRecordInput,
} from "./__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore, type CallLog } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const HOST_PID = 4_242
const OLD = new Date(Date.parse("2026-01-01T00:00:00.000Z")).toISOString()

describe("host-session teardown: detach on shutdown, close on destroy, close on TTL, never a signal", () => {
  test("#given a resident host-session child #when the parent session shuts down #then the client detaches and the record parks rpc_detached", async () => {
    // given
    const store = tempStore()
    const order: CallLog = []
    const fixture = hostLifecycleDeps({ store, hostPid: HOST_PID })
    seedRecord(store, {
      ...hostSessionRecordInput("st_0a000001", hostSession("st_0a000001")),
      status: "running",
      residency_state: "resident",
      host_pid: HOST_PID,
    })
    fixture.registry.add(hostSessionHandle("st_0a000001", order))
    const lifecycle = createTaskLifecycle(fixture.deps)

    // when
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })

    // then
    expect(order).toEqual(["abort:st_0a000001", "detach:st_0a000001"])
    expect(fixture.daemon.closed).toEqual([])
    expect(store.load("st_0a000001")?.residency_state).toBe("rpc_detached")
    expect(summary.suspended_rpc).toBe(1)
  })

  test("#given a resident host-session child #when the destruction port cancels it #then the session is closed and no pid is signalled", async () => {
    // given
    const store = tempStore()
    const order: CallLog = []
    const signals: string[] = []
    const fixture = hostLifecycleDeps({ store, hostPid: HOST_PID, signals })
    seedRecord(store, {
      ...hostSessionRecordInput("st_0a000002", hostSession("st_0a000002")),
      status: "running",
      residency_state: "resident",
      host_pid: HOST_PID,
    })
    fixture.registry.add(hostSessionHandle("st_0a000002", order))
    const lifecycle = createTaskLifecycle(fixture.deps)

    // when
    await lifecycle.destroyResidentTask("st_0a000002", "cancel")

    // then
    expect(order).toEqual(["close_session:st_0a000002", "detach:st_0a000002"])
    expect(signals).toEqual([])
    expect(store.load("st_0a000002")?.residency_state).toBe("disposed")
  })

  test("#given an expired host-session orphan the daemon still holds #when TTL sweeps #then the session is closed through the single close writer and nothing is signalled", async () => {
    // given
    const store = tempStore()
    const signals: string[] = []
    const identity = hostSession("st_0a000003")
    const fixture = hostLifecycleDeps({ store, hostPid: HOST_PID, signals })
    fixture.daemon.hold(identity.session_path)
    seedRecord(store, {
      ...hostSessionRecordInput("st_0a000003", identity),
      status: "completed",
      residency_state: "rpc_detached",
      updated_at: OLD,
    })
    const lifecycle = createTaskLifecycle(fixture.deps)

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(fixture.daemon.closed).toEqual([identity.session_path])
    expect(signals).toEqual([])
    expect(result.deleted).toEqual(["st_0a000003"])
  })

  test("#given an expired host-session orphan the daemon already parked #when TTL sweeps #then no close is issued", async () => {
    // given
    const store = tempStore()
    const signals: string[] = []
    const identity = hostSession("st_0a000004")
    const fixture = hostLifecycleDeps({ store, hostPid: HOST_PID, signals })
    seedRecord(store, {
      ...hostSessionRecordInput("st_0a000004", identity),
      status: "completed",
      residency_state: "rpc_detached",
      updated_at: OLD,
    })
    const lifecycle = createTaskLifecycle(fixture.deps)

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(fixture.daemon.closed).toEqual([])
    expect(signals).toEqual([])
    expect(result.deleted).toEqual(["st_0a000004"])
  })

  test("#given a LEGACY expired rpc orphan with a bare pid and no runner_kind #when TTL sweeps #then the pid path is unchanged and no session close is attempted", async () => {
    // given
    const store = tempStore()
    const signals: string[] = []
    const fixture = hostLifecycleDeps({ store, hostPid: HOST_PID, signals, isAlive: (pid) => pid === 9_001 })
    seedRecord(store, {
      task_id: "st_0a000005",
      execution_mode: "process",
      status: "completed",
      residency_state: "rpc_detached",
      pid: 9_001,
      updated_at: OLD,
    })
    const lifecycle = createTaskLifecycle(fixture.deps)

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(signals).toEqual(["SIGTERM:9001", "SIGKILL:9001"])
    expect(fixture.daemon.closed).toEqual([])
    expect(fixture.daemon.listCalls).toBe(0)
    expect(result.deleted).toEqual(["st_0a000005"])
  })
})
