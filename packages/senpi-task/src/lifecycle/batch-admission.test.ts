import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import type { TaskRecordStore } from "../store"
import { acquireSessionAdmissionLease, type SessionAdmissionLease } from "./admission-lease"
import { resolveContext, type LifecycleContext } from "./context"
import { admitSuspendedBatch, reclaimOrphanedResident } from "./residency"
import {
  cleanupProjects,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
} from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

function iso(offsetMs: number): string {
  return new Date(1_000_000 + offsetMs).toISOString()
}

function contextFor(store: TaskRecordStore, cap: number | "unlimited"): LifecycleContext {
  return resolveContext({ store, registry: new FakeRegistry(), config: settings({ residency_max_children: cap }) })
}

describe("admitSuspendedBatch (capacity-aware batch admission)", () => {
  test("#given unlimited residency with existing residents #when suspended children resume #then every candidate is claimed", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_000000d0", status: "running", residency_state: "resident" })
    seedRecord(store, { task_id: "st_000000d1", status: "completed", residency_state: "resident" })
    seedRecord(store, { task_id: "st_000000d2", status: "running", residency_state: "persisted_only" })
    seedRecord(store, { task_id: "st_000000d3", status: "completed", residency_state: "rpc_detached" })
    seedRecord(store, { task_id: "st_000000d4", status: "error", residency_state: "persisted_only" })
    const context = contextFor(store, "unlimited")

    // when
    const result = await admitSuspendedBatch(context, "parent-1")

    // then
    expect(result.outcomes).toHaveLength(3)
    expect(result.outcomes.every((outcome) => outcome.kind === "claimed")).toBe(true)
    expect(store.load("st_000000d2")?.residency_state).toBe("resident")
    expect(store.load("st_000000d3")?.residency_state).toBe("resident")
    expect(store.load("st_000000d4")?.residency_state).toBe("resident")
  })

  test("#given 10 suspended (3 running, 7 completed) and 2 residents under cap 8 #when the batch admits #then 3 running + 3 MRU completed are claimed and 4 defer capacity", async () => {
    // given: 2 residents (one owned by a live foreign pid - it still consumes a slot)
    const store = tempStore()
    seedRecord(store, { task_id: "st_000000e8", status: "running", residency_state: "resident", host_pid: process.pid })
    seedRecord(store, { task_id: "st_000000e9", status: "completed", residency_state: "resident", host_pid: 424_242 })
    // and 3 non-terminal suspended records, deliberately OLDER than the completed MRU set
    seedRecord(store, { task_id: "st_00000010", status: "running", residency_state: "persisted_only", updated_at: iso(5) })
    seedRecord(store, { task_id: "st_00000011", status: "running", residency_state: "rpc_detached", updated_at: iso(15) })
    seedRecord(store, { task_id: "st_00000012", status: "pending", residency_state: "persisted_only", updated_at: iso(25) })
    // and 7 terminal suspended records, the two most recent sharing a timestamp (tie-break task_id ASC)
    seedRecord(store, { task_id: "st_00000020", status: "completed", residency_state: "persisted_only", updated_at: iso(0) })
    seedRecord(store, { task_id: "st_00000021", status: "completed", residency_state: "rpc_detached", updated_at: iso(10) })
    seedRecord(store, { task_id: "st_00000022", status: "error", residency_state: "persisted_only", updated_at: iso(20) })
    seedRecord(store, { task_id: "st_00000023", status: "interrupted", residency_state: "persisted_only", updated_at: iso(30) })
    seedRecord(store, { task_id: "st_00000024", status: "completed", residency_state: "rpc_detached", updated_at: iso(40) })
    seedRecord(store, { task_id: "st_00000025", status: "completed", residency_state: "persisted_only", updated_at: iso(50) })
    seedRecord(store, { task_id: "st_00000026", status: "completed", residency_state: "persisted_only", updated_at: iso(50) })
    const context = contextFor(store, 8)

    // when
    const result = await admitSuspendedBatch(context, "parent-1")

    // then: available = 8 - 2 = 6; non-terminal first (recency cannot jump the class boundary),
    // then terminal MRU with the iso(50) tie broken by task_id ASC
    expect(result.lease).toBe("acquired")
    expect(result.outcomes.map((outcome) => outcome.task_id)).toEqual([
      "st_00000012",
      "st_00000011",
      "st_00000010",
      "st_00000025",
      "st_00000026",
      "st_00000024",
      "st_00000023",
      "st_00000022",
      "st_00000021",
      "st_00000020",
    ])
    for (const outcome of result.outcomes.slice(0, 6)) expect(outcome.kind).toBe("claimed")
    for (const outcome of result.outcomes.slice(6)) {
      expect(outcome.kind).toBe("deferred")
      if (outcome.kind === "deferred") expect(outcome.reason).toBe("capacity")
    }
    // and the claims are stamped with THIS host while overflow stays suspended (never lost, never evicted)
    expect(store.load("st_00000012")?.residency_state).toBe("resident")
    expect(store.load("st_00000012")?.host_pid).toBe(process.pid)
    expect(store.load("st_00000025")?.residency_state).toBe("resident")
    expect(store.load("st_00000023")?.residency_state).toBe("persisted_only")
    expect(store.load("st_00000020")?.residency_state).toBe("persisted_only")
    // and the pre-existing residents were never touched (no LRU eviction to make room)
    expect(store.load("st_000000e8")?.residency_state).toBe("resident")
    expect(store.load("st_000000e9")?.residency_state).toBe("resident")
    expect(store.load("st_000000e9")?.host_pid).toBe(424_242)
  })

  test("#given cap 2 with 3 residents #when the batch admits #then nothing is revived and the residents are kept", async () => {
    // given: the configured cap sits BELOW the current resident count
    const store = tempStore()
    seedRecord(store, { task_id: "st_000000e0", status: "running", residency_state: "resident", host_pid: process.pid })
    seedRecord(store, { task_id: "st_000000e1", status: "running", residency_state: "resident", host_pid: process.pid })
    seedRecord(store, { task_id: "st_000000e2", status: "completed", residency_state: "resident", host_pid: 424_242 })
    seedRecord(store, { task_id: "st_00000030", status: "running", residency_state: "persisted_only" })
    seedRecord(store, { task_id: "st_00000031", status: "completed", residency_state: "rpc_detached" })
    const context = contextFor(store, 2)

    // when
    const result = await admitSuspendedBatch(context, "parent-1")

    // then: zero revived, all overflow deferred, no destruction of the owned residents
    expect(result.lease).toBe("acquired")
    expect(result.outcomes).toHaveLength(2)
    for (const outcome of result.outcomes) {
      expect(outcome.kind).toBe("deferred")
      if (outcome.kind === "deferred") expect(outcome.reason).toBe("capacity")
    }
    expect(store.load("st_00000030")?.residency_state).toBe("persisted_only")
    expect(store.load("st_00000031")?.residency_state).toBe("rpc_detached")
    expect(store.load("st_000000e0")?.residency_state).toBe("resident")
    expect(store.load("st_000000e1")?.residency_state).toBe("resident")
    expect(store.load("st_000000e2")?.residency_state).toBe("resident")
    expect(store.load("st_000000e2")?.host_pid).toBe(424_242)
  })

  test("#given another session's, cancelled, and killed suspended records #when the batch admits #then only this session's revivable records are claimed", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000040", parent_session_id: "other", status: "running", residency_state: "persisted_only" })
    seedRecord(store, { task_id: "st_00000041", status: "cancelled", residency_state: "persisted_only" })
    seedRecord(store, { task_id: "st_00000042", status: "running", residency_state: "persisted_only", killed: true })
    seedRecord(store, { task_id: "st_00000043", status: "running", residency_state: "persisted_only" })
    const context = contextFor(store, 8)

    // when
    const result = await admitSuspendedBatch(context, "parent-1")

    // then
    expect(result.outcomes).toEqual([{ task_id: "st_00000043", kind: "claimed" }])
    expect(store.load("st_00000040")?.residency_state).toBe("persisted_only")
    expect(store.load("st_00000041")?.residency_state).toBe("persisted_only")
    expect(store.load("st_00000042")?.residency_state).toBe("persisted_only")
  })

  test("#given lease acquisition reports contention #when a batch admission starts #then the whole batch defers lock_contended and nothing is claimed", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000050", status: "running", residency_state: "persisted_only" })
    seedRecord(store, { task_id: "st_00000051", status: "completed", residency_state: "rpc_detached" })
    const context = contextFor(store, 8)
    let acquireCalls = 0
    const acquireLease: typeof acquireSessionAdmissionLease = async () => {
      acquireCalls += 1
      return { kind: "contended" }
    }

    // when
    const result = await admitSuspendedBatch(context, "parent-1", { acquireLease })

    // then: a typed deferral for the whole batch - never a throw aborting session start
    expect(acquireCalls).toBe(1)
    expect(result.lease).toBe("lock_contended")
    expect(result.outcomes).toHaveLength(2)
    for (const outcome of result.outcomes) {
      expect(outcome.kind).toBe("deferred")
      if (outcome.kind === "deferred") expect(outcome.reason).toBe("lock_contended")
    }
    expect(store.load("st_00000050")?.residency_state).toBe("persisted_only")
    expect(store.load("st_00000051")?.residency_state).toBe("rpc_detached")
  })

  test("#given the lease is displaced mid-batch #when the holder re-reads it before each mutation #then it aborts the remaining claims", async () => {
    // given: three candidates and a lease whose ownership flips after the first fencing check
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000060", status: "completed", residency_state: "persisted_only", updated_at: iso(0) })
    seedRecord(store, { task_id: "st_00000061", status: "completed", residency_state: "persisted_only", updated_at: iso(10) })
    seedRecord(store, { task_id: "st_00000062", status: "completed", residency_state: "persisted_only", updated_at: iso(20) })
    const context = contextFor(store, 8)
    let ownershipChecks = 0
    let released = false
    const displacedLease: SessionAdmissionLease = {
      token: "displaced",
      path: join(store.stateDir, "locks", "session-parent-1.lock"),
      isOwner: () => {
        ownershipChecks += 1
        return ownershipChecks === 1
      },
      release: () => {
        released = true
      },
    }
    const acquireLease: typeof acquireSessionAdmissionLease = async () => ({ kind: "acquired", lease: displacedLease })

    // when
    const result = await admitSuspendedBatch(context, "parent-1", { acquireLease })

    // then: exactly one claim (the MRU head) landed before the fencing check tripped; the
    // displaced holder aborted instead of writing under a lost lease
    expect(result.lease).toBe("lease_lost")
    expect(result.outcomes).toEqual([
      { task_id: "st_00000062", kind: "claimed" },
      { task_id: "st_00000061", kind: "deferred", reason: "lease_lost" },
      { task_id: "st_00000060", kind: "deferred", reason: "lease_lost" },
    ])
    expect(store.load("st_00000062")?.residency_state).toBe("resident")
    expect(store.load("st_00000061")?.residency_state).toBe("persisted_only")
    expect(store.load("st_00000060")?.residency_state).toBe("persisted_only")
    expect(released).toBe(true)
  })
})

describe("reclaimOrphanedResident (reclamation bypasses admission)", () => {
  test("#given the cap fully consumed and an orphaned resident #when reclaiming the orphan #then it is claimed without touching the cap or the other residents", () => {
    // given: cap 2 fully consumed by live residents, plus one resident whose owner pid is dead
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000070", status: "running", residency_state: "resident", host_pid: process.pid })
    seedRecord(store, { task_id: "st_00000071", status: "running", residency_state: "resident", host_pid: process.pid })
    const orphan = seedRecord(store, { task_id: "st_00000072", status: "completed", residency_state: "resident", host_pid: 999_999 })
    const context = contextFor(store, 2)

    // when
    const result = reclaimOrphanedResident(context, orphan)

    // then: the orphan already occupies its slot, so no capacity gate applies and nobody is evicted
    expect(result).toBe("claimed")
    expect(store.load("st_00000072")?.host_pid).toBe(process.pid)
    expect(store.load("st_00000072")?.residency_state).toBe("resident")
    expect(store.load("st_00000070")?.residency_state).toBe("resident")
    expect(store.load("st_00000071")?.residency_state).toBe("resident")
  })

  test("#given a reclaim raced and lost the expected-owner CAS #when retrying with the stale observation #then it reports not_claimable and touches nothing", () => {
    // given
    const store = tempStore()
    const orphan = seedRecord(store, { task_id: "st_00000080", status: "completed", residency_state: "resident", host_pid: 999_999 })
    const context = contextFor(store, 2)

    // when: a winner claims first, then the loser retries with its stale observation
    expect(reclaimOrphanedResident(context, orphan)).toBe("claimed")
    const loser = reclaimOrphanedResident(context, orphan)

    // then: the loser's CAS fails because host_pid no longer equals the dead owner it observed
    expect(loser).toBe("not_claimable")
    expect(store.load("st_00000080")?.host_pid).toBe(process.pid)
  })
})
