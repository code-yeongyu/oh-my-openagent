import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
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
  return { isAlive: (pid) => alive.has(pid), signal: () => {} }
}

// Create the durable artifacts a suspended-era child leaves behind: event log, child session dir,
// and completion spill file.
function seedChildArtifacts(store: TaskRecordStore, taskId: string): { childDir: string; spillPath: string; logPath: string } {
  store.appendEvent(taskId, { type: "seed", payload: {} })
  const childDir = join(store.stateDir, "children", taskId)
  mkdirSync(join(childDir, "sessions", taskId), { recursive: true })
  writeFileSync(join(childDir, "sessions", taskId, "x.jsonl"), '{"role":"user"}\n', "utf8")
  const spillDir = join(store.stateDir, "completion-results")
  mkdirSync(spillDir, { recursive: true })
  const spillPath = join(spillDir, `${taskId}.txt`)
  writeFileSync(spillPath, "spilled final response", "utf8")
  return { childDir, spillPath, logPath: join(store.stateDir, "logs", `${taskId}.jsonl`) }
}

describe("cleanupExpiredRecords (TTL)", () => {
  test("#given an expired terminal record #when cleaning #then its record and log are deleted", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000001", status: "completed", updated_at: iso(TTL + 1) })
    store.appendEvent("st_00000001", { type: "seed", payload: {} })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.deleted).toContain("st_00000001")
    expect(existsSync(recordPath(store, "st_00000001"))).toBe(false)
    expect(existsSync(join(store.stateDir, "logs", "st_00000001.jsonl"))).toBe(false)
  })

  test("#given a fresh terminal record #when cleaning #then it is retained", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000002", status: "completed", updated_at: iso(TTL - 1) })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.retained).toContain("st_00000002")
    expect(existsSync(recordPath(store, "st_00000002"))).toBe(true)
  })

  test("#given an old NON-terminal record #when cleaning #then it is retained", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000003", status: "running", updated_at: iso(TTL + 1000) })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.retained).toContain("st_00000003")
  })

  test("#given a freshly claimed pending record #when the cutoff is far in the future #then it is retained", async () => {
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
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.retained).toContain("st_00000007")
    expect(existsSync(recordPath(store, "st_00000007"))).toBe(true)
  })

  test("#given an old lost RPC record with a LIVE pid #when cleaning #then it is retained (no pid-dead proof)", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000004", status: "lost", execution_mode: "process", pid: 700, updated_at: iso(TTL + 1000) })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now, signaller: aliveSignaller(new Set([700])) })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.retained).toContain("st_00000004")
    expect(existsSync(recordPath(store, "st_00000004"))).toBe(true)
  })

  test("#given an old lost RPC record with a DEAD pid #when cleaning #then it is deleted (pid-dead proven)", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000005", status: "lost", execution_mode: "process", pid: 701, updated_at: iso(TTL + 1000) })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now, signaller: aliveSignaller(new Set()) })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.deleted).toContain("st_00000005")
  })

  test("#given an expired terminal record owned by a live resident handle #when cleaning #then it is retained until the handle is forgotten", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000006", status: "completed", updated_at: iso(TTL + 1) })
    const registry = new FakeRegistry()
    registry.add(fakeHandle("st_00000006", "in-process", []))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings({ ttl_ms: TTL }), now })

    // when
    const retained = await lifecycle.cleanupExpiredRecords()

    // then the live resident protects the record; deleting it would orphan an in-memory handle
    expect(retained.retained).toContain("st_00000006")
    expect(existsSync(recordPath(store, "st_00000006"))).toBe(true)

    // when the resident is forgotten and cleanup runs again
    registry.forget("st_00000006")
    const afterForget = await lifecycle.cleanupExpiredRecords()

    // then the expired terminal record can be safely removed
    expect(afterForget.deleted).toContain("st_00000006")
    expect(existsSync(recordPath(store, "st_00000006"))).toBe(false)
  })
})

describe("cleanupExpiredRecords (TTL) cross-process ownership", () => {
  test("#given an expired resident record owned by a LIVE foreign process #when cleaning #then it is retained", async () => {
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
    const result = await lifecycle.cleanupExpiredRecords()

    // then deleting it would orphan the sibling's live handle and let late appends recreate the log
    expect(result.retained).toContain("st_00000010")
    expect(existsSync(recordPath(store, "st_00000010"))).toBe(true)
  })

  test("#given an expired resident record whose foreign owner is DEAD #when cleaning #then it is deleted", async () => {
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
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.deleted).toContain("st_00000011")
  })
})

describe("cleanupExpiredRecords (TTL) suspended-era artifacts", () => {
  test("#given an expired terminal persisted_only record with child artifacts #when cleaning #then record, children dir, spill, and log are all deleted", async () => {
    // given a suspended child that finished and aged out - every durable artifact must go
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000020", status: "completed", residency_state: "persisted_only", updated_at: iso(TTL + 1) })
    const artifacts = seedChildArtifacts(store, "st_00000020")
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.deleted).toContain("st_00000020")
    expect(existsSync(recordPath(store, "st_00000020"))).toBe(false)
    expect(existsSync(artifacts.childDir)).toBe(false)
    expect(existsSync(artifacts.spillPath)).toBe(false)
    expect(existsSync(artifacts.logPath)).toBe(false)
  })

  test("#given an expired NON-terminal suspended record #when cleaning #then it and its child artifacts are retained", async () => {
    // given a suspended child whose work is still in flight - TTL must never reap it
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000021", status: "running", residency_state: "persisted_only", updated_at: iso(TTL + 1000) })
    const artifacts = seedChildArtifacts(store, "st_00000021")
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.retained).toContain("st_00000021")
    expect(existsSync(recordPath(store, "st_00000021"))).toBe(true)
    expect(existsSync(artifacts.childDir)).toBe(true)
    expect(existsSync(artifacts.spillPath)).toBe(true)
  })

  test("#given a record claimed by revival between the scan and the delete #when cleaning #then the claimed record is retained", async () => {
    // given an expired suspended record that a revival claims at the exact deletion boundary
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000022", status: "completed", residency_state: "persisted_only", updated_at: iso(TTL + 1000) })
    const HOST = 1111
    let claimed = false
    const racingStore: TaskRecordStore = {
      ...store,
      list: () => {
        const result = store.list()
        if (!claimed) {
          claimed = true
          // a REAL claim (the revival CAS) lands after the scan observed the record
          store.mutate("st_00000022", (record) => ({ ...record, residency_state: "resident", host_pid: HOST }))
        }
        return result
      },
    }
    const lifecycle = createTaskLifecycle({
      store: racingStore,
      registry: new FakeRegistry(),
      config: settings({ ttl_ms: TTL }),
      now,
      signaller: aliveSignaller(new Set([HOST])),
      hostPid: HOST,
    })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then the atomic conditional tombstone re-reads under the lock and sees the fresh claim;
    // a scan-then-remove implementation deletes the claimed record here and FAILS this test
    expect(result.deleted).not.toContain("st_00000022")
    expect(result.retained).toContain("st_00000022")
    const record = store.load("st_00000022")
    expect(record?.residency_state).toBe("resident")
    expect(record?.host_pid).toBe(HOST)
  })

  test("#given an expired terminal record with an undelivered notify_on_terminal notification #when cleaning #then it is retained until the epoch is delivered", async () => {
    // given
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_00000023",
      status: "completed",
      residency_state: "persisted_only",
      updated_at: iso(TTL + 1000),
      notify_on_terminal: true,
      run_epoch: 2,
      notified_epoch: 0,
    })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const first = await lifecycle.cleanupExpiredRecords()

    // then the undelivered notification protects the record (and its spill) from TTL
    expect(first.retained).toContain("st_00000023")
    expect(existsSync(recordPath(store, "st_00000023"))).toBe(true)

    // when the notification is delivered for the current epoch and the sweep runs again
    store.mutate("st_00000023", (record) => ({ ...record, notification: { ...record.notification, notified_epoch: 2 } }))
    const second = await lifecycle.cleanupExpiredRecords()

    // then TTL may finally expunge it
    expect(second.deleted).toContain("st_00000023")
    expect(existsSync(recordPath(store, "st_00000023"))).toBe(false)
  })

  test("#given an expired legacy terminal record whose only marker is notification_failed_epoch #when cleaning #then it is retained until delivered", async () => {
    // given a pre-upgrade record: no notify_on_terminal flag, a failed delivery still pending retry
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_00000024",
      status: "completed",
      residency_state: "persisted_only",
      updated_at: iso(TTL + 1000),
      run_epoch: 2,
      notified_epoch: 0,
      notification_failed_epoch: 2,
    })
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const first = await lifecycle.cleanupExpiredRecords()

    // then deleting it between a failed retry and the next one would silently lose the notification
    expect(first.retained).toContain("st_00000024")
    expect(existsSync(recordPath(store, "st_00000024"))).toBe(true)

    // when the retry finally delivers the epoch and the sweep runs again
    store.mutate("st_00000024", (record) => ({ ...record, notification: { ...record.notification, notified_epoch: 2 } }))
    const second = await lifecycle.cleanupExpiredRecords()

    // then
    expect(second.deleted).toContain("st_00000024")
    expect(existsSync(recordPath(store, "st_00000024"))).toBe(false)
  })

  test("#given a sweep crashed after tombstoning #when the next sweep runs #then it finishes deleting the artifacts idempotently", async () => {
    // given a leftover tombstone plus the not-yet-deleted artifacts of an interrupted expunge
    const store = tempStore()
    seedRecord(store, { task_id: "st_00000025", status: "completed", residency_state: "persisted_only", updated_at: iso(TTL + 1000) })
    const artifacts = seedChildArtifacts(store, "st_00000025")
    const tombstonePath = `${recordPath(store, "st_00000025")}.expunging`
    renameSync(recordPath(store, "st_00000025"), tombstonePath)
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings({ ttl_ms: TTL }), now })

    // when
    const first = await lifecycle.cleanupExpiredRecords()

    // then the tombstoned record (already committed to deletion, never resurrected) is finished off
    expect(first.deleted).toContain("st_00000025")
    expect(existsSync(tombstonePath)).toBe(false)
    expect(existsSync(artifacts.childDir)).toBe(false)
    expect(existsSync(artifacts.spillPath)).toBe(false)
    expect(existsSync(artifacts.logPath)).toBe(false)
    expect(store.load("st_00000025")).toBeNull()

    // when the sweep runs again
    const second = await lifecycle.cleanupExpiredRecords()

    // then completion is idempotent - no throw, nothing reappears
    expect(second.deleted).not.toContain("st_00000025")
    expect(existsSync(tombstonePath)).toBe(false)
    expect(existsSync(artifacts.childDir)).toBe(false)
  })

  test("#given an expired terminal rpc record with a LIVE orphan pid #when cleaning #then the orphan is destroyed BEFORE its artifacts are deleted", async () => {
    // given a half-torn-down rpc child: terminal record, no handle, no live host claim, pid alive
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_00000026",
      status: "completed",
      residency_state: "rpc_detached",
      execution_mode: "process",
      pid: 9001,
      updated_at: iso(TTL + 1000),
    })
    const artifacts = seedChildArtifacts(store, "st_00000026")
    const signals: Array<readonly [number, string]> = []
    const childDirExistedAtSignal: boolean[] = []
    const alive = new Set([9001])
    const signaller: ProcessSignaller = {
      isAlive: (pid) => alive.has(pid),
      signal: (pid, signal) => {
        signals.push([pid, signal])
        childDirExistedAtSignal.push(existsSync(artifacts.childDir))
      },
    }
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings({ ttl_ms: TTL }),
      now,
      signaller,
      orphanKillDelayMs: 0,
    })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then the no-orphan law: SIGTERM, then SIGKILL when it survives the escalation window, and
    // every signal landed BEFORE phase 2 artifact deletion
    expect(signals).toEqual([
      [9001, "SIGTERM"],
      [9001, "SIGKILL"],
    ])
    expect(childDirExistedAtSignal).toEqual([true, true])
    expect(result.deleted).toContain("st_00000026")
    expect(existsSync(recordPath(store, "st_00000026"))).toBe(false)
    expect(existsSync(artifacts.childDir)).toBe(false)
  })
})
