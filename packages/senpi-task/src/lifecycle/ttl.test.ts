import { existsSync } from "node:fs"
import { join } from "node:path"
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

const now = () => 100_000_000
const TTL = 10_000

function iso(ageMs: number): string {
  return new Date(now() - ageMs).toISOString()
}

function recordPath(store: TaskRecordStore, taskId: string): string {
  return join(store.stateDir, "tasks", `${taskId}.json`)
}

function aliveSignaller(alive: Set<number>): ProcessSignaller {
  return { isAlive: (pid) => alive.has(pid), signal: () => {} }
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
})
