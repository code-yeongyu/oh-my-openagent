import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import type { ProcessSignaller } from "./port"
import {
  cleanupProjects,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
} from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

type SignalCall = { readonly pid: number; readonly signal: string }

function fakeSignaller(alive: Set<number>, calls: SignalCall[], store?: TaskRecordStore, watched?: string): ProcessSignaller {
  return {
    isAlive: (pid) => alive.has(pid),
    signal: (pid, signal) => {
      if (store !== undefined && watched !== undefined) {
        // Prove breadcrumbs land BEFORE the orphan is signalled: the record is already `lost`.
        expect(store.load(watched)?.status).toBe("lost")
      }
      calls.push({ pid, signal })
      if (signal === "SIGKILL" || signal === "SIGTERM") alive.delete(pid)
    },
  }
}

const now = () => 5_000_000

function iso(offsetMs: number): string {
  return new Date(now() + offsetMs).toISOString()
}

describe("reconcileOnSessionStart (6-case truth table)", () => {
  test("case1 rpc live pid + fresh heartbeat -> lost recorded FIRST then orphan terminated", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000001", status: "running", residency_state: "resident", execution_mode: "process", pid: 900, child_session_id: "sess-live", updated_at: iso(-1_000) })
    const calls: SignalCall[] = []
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), now, signaller: fakeSignaller(new Set([900]), calls, store, "st_00000001"), orphanKillDelayMs: 0 })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost_and_terminated")
    expect(store.load("st_00000001")?.status).toBe("lost")
    expect(store.load("st_00000001")?.error_message).toContain("900")
    expect(store.load("st_00000001")?.error_message).toContain("sess-live")
    expect(calls.map((call) => call.signal)).toContain("SIGTERM")
  })

  test("case2 rpc live pid + STALE heartbeat -> still lost + terminated (no reattach possible)", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000002", status: "running", residency_state: "resident", execution_mode: "process", pid: 901, updated_at: iso(-10 * 60_000) })
    const calls: SignalCall[] = []
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), now, signaller: fakeSignaller(new Set([901]), calls), orphanKillDelayMs: 0 })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost_and_terminated")
    expect(result.outcomes[0]?.reason).toContain("stale")
    expect(calls.length).toBeGreaterThan(0)
  })

  test("case3 rpc dead pid -> lost, NO signal sent", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000003", status: "running", residency_state: "resident", execution_mode: "process", pid: 902, updated_at: iso(-1_000) })
    const calls: SignalCall[] = []
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), now, signaller: fakeSignaller(new Set(), calls) })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(store.load("st_00000003")?.status).toBe("lost")
    expect(calls).toHaveLength(0)
  })

  test("case4 rpc with NO pid -> lost, NO signal sent", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000004", status: "running", residency_state: "resident", execution_mode: "process", updated_at: iso(-1_000) })
    const calls: SignalCall[] = []
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), now, signaller: fakeSignaller(new Set(), calls) })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(calls).toHaveLength(0)
  })

  test("case5 previous-process in-process task -> lost, NO signal sent", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000005", status: "running", residency_state: "resident", execution_mode: "in-process", updated_at: iso(-1_000) })
    const calls: SignalCall[] = []
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), now, signaller: fakeSignaller(new Set([999]), calls) })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(store.load("st_00000005")?.status).toBe("lost")
    expect(calls).toHaveLength(0)
  })

  test("case6 completed terminal record -> resumed view, unchanged", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000006", status: "completed", residency_state: "resident", updated_at: iso(-1_000) })
    const calls: SignalCall[] = []
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings(), now, signaller: fakeSignaller(new Set(), calls) })

    // when
    const result = await lifecycle.reconcileOnSessionStart()

    // then
    expect(result.outcomes[0]?.kind).toBe("resumed")
    expect(store.load("st_00000006")?.status).toBe("completed")
    expect(calls).toHaveLength(0)
  })
})
