import { existsSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import type { ProcessSignaller } from "./port"
import {
  cleanupProjects,
  fakeHandle,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
} from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const now = () => 100_000_000
const TTL = 10_000

function iso(ageMs: number): string {
  return new Date(now() - ageMs).toISOString()
}

function recordPath(store: TaskRecordStore, taskId: string): string {
  return join(store.stateDir, "tasks", `${taskId}.json`)
}

function aliveSignaller(alive: Set<number>): ProcessSignaller {
  return { isAlive: (pid) => alive.has(pid) }
}

describe("cleanupExpiredRecords (TTL)", () => {
  test("#given an expired terminal record #when cleaning #then its record and log are deleted", () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000001", status: "completed", updated_at: iso(TTL + 1) })
    store.appendEvent("st_00000001", { type: "seed", payload: {} })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const result = lifecycle.cleanupExpiredRecords()

    // then
    expect(result.deleted).toContain("st_00000001")
    expect(existsSync(recordPath(store, "st_00000001"))).toBe(false)
    expect(existsSync(join(store.stateDir, "logs", "st_00000001.jsonl"))).toBe(false)
  })

  test("#given a fresh terminal record #when cleaning #then it is retained", () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000002", status: "completed", updated_at: iso(TTL - 1) })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const result = lifecycle.cleanupExpiredRecords()

    // then
    expect(result.retained).toContain("st_00000002")
    expect(existsSync(recordPath(store, "st_00000002"))).toBe(true)
  })

  test("#given an old NON-terminal record #when cleaning #then it is retained", () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000003", status: "running", updated_at: iso(TTL + 1000) })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const result = lifecycle.cleanupExpiredRecords()

    // then
    expect(result.retained).toContain("st_00000003")
  })

  test("#given a freshly claimed pending record #when the cutoff is far in the future #then it is retained", () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000007", status: "pending", updated_at: iso(0) })
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings({ ttl_ms: TTL }),
      now: () => now() + TTL * 100,
    })

    // when
    const result = lifecycle.cleanupExpiredRecords()

    // then
    expect(result.retained).toContain("st_00000007")
    expect(existsSync(recordPath(store, "st_00000007"))).toBe(true)
  })

  test("#given an old lost RPC record with a LIVE pid #when cleaning #then it is retained (no pid-dead proof)", () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000004", status: "lost", execution_mode: "process", pid: 700, updated_at: iso(TTL + 1000) })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now, signaller: aliveSignaller(new Set([700])) })

    // when
    const result = lifecycle.cleanupExpiredRecords()

    // then
    expect(result.retained).toContain("st_00000004")
    expect(existsSync(recordPath(store, "st_00000004"))).toBe(true)
  })

  test("#given an old lost RPC record with a DEAD pid #when cleaning #then it is deleted (pid-dead proven)", () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000005", status: "lost", execution_mode: "process", pid: 701, updated_at: iso(TTL + 1000) })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now, signaller: aliveSignaller(new Set()) })

    // when
    const result = lifecycle.cleanupExpiredRecords()

    // then
    expect(result.deleted).toContain("st_00000005")
  })

  test("#given an expired terminal record owned by a live resident handle #when cleaning #then it is retained until the handle is forgotten", () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000006", status: "completed", updated_at: iso(TTL + 1) })
    const registry = new FakeRegistry()
    registry.add(fakeHandle("st_00000006", "in-process", []))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings({ ttl_ms: TTL }), now })

    // when
    const retained = lifecycle.cleanupExpiredRecords()

    // then the live resident protects the record; deleting it would orphan an in-memory handle
    expect(retained.retained).toContain("st_00000006")
    expect(existsSync(recordPath(store, "st_00000006"))).toBe(true)

    // when the resident is forgotten and cleanup runs again
    registry.forget("st_00000006")
    const afterForget = lifecycle.cleanupExpiredRecords()

    // then the expired terminal record can be safely removed
    expect(afterForget.deleted).toContain("st_00000006")
    expect(existsSync(recordPath(store, "st_00000006"))).toBe(false)
  })
})

describe("cleanupExpiredRecords (TTL) cross-process ownership", () => {
  test("#given an expired resident record owned by a LIVE foreign process #when cleaning #then it is retained", () => {
    // given a sibling senpi process still holds this child resident (revivable)
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000010", status: "completed", residency_state: "resident", updated_at: iso(TTL + 1000), host_pid: 4242 })
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings({ ttl_ms: TTL }),
      now,
      signaller: aliveSignaller(new Set([4242])),
      hostPid: 1111,
    })

    // when
    const result = lifecycle.cleanupExpiredRecords()

    // then deleting it would orphan the sibling's live handle and let late appends recreate the log
    expect(result.retained).toContain("st_00000010")
    expect(existsSync(recordPath(store, "st_00000010"))).toBe(true)
  })

  test("#given an expired resident record whose foreign owner is DEAD #when cleaning #then it is deleted", () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000011", status: "completed", residency_state: "resident", updated_at: iso(TTL + 1000), host_pid: 4242 })
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings({ ttl_ms: TTL }),
      now,
      signaller: aliveSignaller(new Set()),
      hostPid: 1111,
    })

    // when
    const result = lifecycle.cleanupExpiredRecords()

    // then
    expect(result.deleted).toContain("st_00000011")
  })
})
