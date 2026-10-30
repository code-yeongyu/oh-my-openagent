import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { HostSessionIdentity } from "../state"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import { cleanupProjects, tempProject } from "../manager/__fixtures__/manager-fakes"
import { createTaskLifecycle } from "./create"
import { hostLifecycleDeps, hostSession } from "./__fixtures__/host-session-fakes"
import { seedRecord } from "./__fixtures__/lifecycle-fakes"
import type { LifecycleDeps } from "./port"

// Invariant: only the sweep attempt that tombstoned a record restores or deletes it, and never while
// its close of the record's session is still unanswered.

afterEach(cleanupProjects)

const EXPIRED = "2000-01-01T00:00:00.000Z"
let sequence = 0

type Close = { readonly answer: PromiseWithResolvers<void> }

function expiredSession(options: { readonly closeTimeoutMs?: number; readonly hostPid?: number; readonly livePids?: readonly number[] } = {}) {
  const store = createTaskRecordStore({ project_dir: tempProject() })
  sequence += 1
  const taskId = `st_${(0xabc00000 + sequence).toString(16)}`
  const identity = hostSession(taskId)
  seedRecord(store, { task_id: taskId, status: "completed", residency_state: "rpc_detached", execution_mode: "process", runner_kind: "host-session", host_session: identity, updated_at: EXPIRED })
  const hostPid = options.hostPid ?? 11_001
  const fixture = hostLifecycleDeps({ store, hostPid, isAlive: (pid) => pid === hostPid || (options.livePids ?? []).includes(pid) })
  fixture.daemon.hold(identity.session_path)
  const closes: Close[] = []
  const asked: Array<PromiseWithResolvers<Close>> = []
  const askedAt = (index: number): PromiseWithResolvers<Close> => (asked[index] ??= Promise.withResolvers<Close>())
  const settled = Promise.withResolvers<"restored" | "deleted">()
  const deps: LifecycleDeps = {
    ...fixture.deps,
    store: {
      ...store,
      restoreExpunging: (id, owner) => {
        store.restoreExpunging(id, owner)
        settled.resolve("restored")
      },
      completeExpunge: (id, owner) => {
        const deleted = store.completeExpunge(id, owner)
        if (deleted) settled.resolve("deleted")
        return deleted
      },
    },
    hostCloseTimeoutMs: options.closeTimeoutMs ?? 60_000,
    hostSessionClose: () => {
      const close = { answer: Promise.withResolvers<void>() }
      askedAt(closes.length).resolve(close)
      closes.push(close)
      return close.answer.promise
    },
  }
  return { store, taskId, identity, deps, closes, closeAsked: (index: number) => askedAt(index).promise, settled: settled.promise }
}

function sweep(deps: LifecycleDeps, overrides: Partial<LifecycleDeps> = {}) {
  const lifecycle = createTaskLifecycle({ ...deps, ...overrides })
  return lifecycle.cleanupExpiredRecords().finally(() => lifecycle.dispose?.())
}

function tombstoned(store: TaskRecordStore, taskId: string): boolean {
  return store.load(taskId) === null && store.loadExpunging(taskId) !== null
}

describe("TTL expunge ownership", () => {
  test("#given a sweep waiting on its close #when a second sweep from another live process runs #then it leaves the tombstone, and only the owner deletes it once confirmed", async () => {
    // given
    const f = expiredSession({ livePids: [22_002] })
    const first = sweep(f.deps)
    const close = await f.closeAsked(0)

    // when
    const second = await sweep(f.deps, { hostPid: 22_002 })
    close.answer.resolve()
    const firstResult = await first

    // then
    expect(second).toEqual({ deleted: [], retained: [] })
    expect(f.closes).toHaveLength(1)
    expect(firstResult.deleted).toEqual([f.taskId])
    expect(f.store.loadExpunging(f.taskId)).toBeNull()
  })

  test("#given a tombstone whose sweeping process is gone #when a sweep runs #then it takes the tombstone over and a refused close restores the record", async () => {
    // given
    const f = expiredSession()
    f.store.tombstoneIfExpired(f.taskId, () => false, { pid: 99_999, token: "crashed-attempt" })

    // when
    const running = sweep(f.deps)
    const close = await f.closeAsked(0)
    close.answer.reject(new Error("close refused"))
    const result = await running

    // then
    expect(result.retained).toEqual([f.taskId])
    expect(f.store.load(f.taskId)).toMatchObject({ residency_state: "rpc_detached", host_session: f.identity })
    expect(f.store.readExpungeOwner(f.taskId)).toBeUndefined()
  })

  for (const late of ["confirmed", "refused"] as const) {
    test(`#given a close that has not answered within hostCloseTimeoutMs #when it is later ${late} #then the record stays unrevivable until then and is ${late === "confirmed" ? "deleted" : "restored"}`, async () => {
      // given
      const f = expiredSession({ closeTimeoutMs: 1 })

      // when
      const result = await sweep(f.deps)
      const [close] = f.closes
      if (close === undefined) throw new Error("expected the sweep to ask for a close")
      const whilePending = tombstoned(f.store, f.taskId)
      const recovery = await sweep(f.deps)
      if (late === "confirmed") close.answer.resolve()
      else close.answer.reject(new Error("close refused"))
      const outcome = await f.settled

      // then
      expect(result.retained).toEqual([f.taskId])
      expect(outcome).toBe(late === "confirmed" ? "deleted" : "restored")
      expect(whilePending).toBe(true)
      expect(recovery).toEqual({ deleted: [], retained: [] })
      expect(f.store.loadExpunging(f.taskId)).toBeNull()
      if (late === "confirmed") expect(f.store.load(f.taskId)).toBeNull()
      else expect(f.store.load(f.taskId)?.host_session).toEqual(f.identity satisfies HostSessionIdentity)
    })
  }

  test("#given an owner file torn by a crashed writer #when a sweep runs #then the tombstone counts as abandoned and is finished", async () => {
    // given
    const f = expiredSession()
    f.store.tombstoneIfExpired(f.taskId, () => false, { pid: 11_001, token: "torn-writer" })
    const ownerFile = join(f.store.stateDir, "tasks", `${f.taskId}.json.expunging.owner`)
    writeFileSync(ownerFile, '{"pid":11001,"tok')

    // when
    const running = sweep(f.deps)
    const close = await f.closeAsked(0)
    close.answer.resolve()
    const result = await running

    // then
    expect(result.deleted).toEqual([f.taskId])
    expect(existsSync(ownerFile)).toBe(false)
  })

  test("#given a late close whose completion hits a storage failure #when the next sweep runs in the same process #then it takes the stranded tombstone over", async () => {
    // given
    const f = expiredSession({ closeTimeoutMs: 1 })
    let failures = 1
    const failing: LifecycleDeps = {
      ...f.deps,
      store: {
        ...f.deps.store,
        completeExpunge: (id, owner) => {
          if (failures > 0) {
            failures -= 1
            throw new Error("EACCES: storage refused")
          }
          return f.deps.store.completeExpunge(id, owner)
        },
      },
    }
    const first = await sweep(failing)
    const [late] = f.closes
    if (late === undefined) throw new Error("expected the first sweep to ask for a close")
    const failed = f.store.readExpungeOwner(f.taskId)
    late.answer.resolve()
    // The late close settles through microtasks only (the fake close and the store are synchronous), so
    // one macrotask turn has drained its failed completion.
    await new Promise<void>((resolve) => setImmediate(resolve))

    // when
    const retry = sweep(failing)
    const close = await f.closeAsked(1)
    close.answer.resolve()
    const result = await retry

    // then
    expect(first.retained).toEqual([f.taskId])
    expect(failed).toBeDefined()
    expect(result.deleted).toEqual([f.taskId])
    expect(f.store.loadExpunging(f.taskId)).toBeNull()
  })

  test("#given an attempt that no longer owns its tombstone #when it completes or restores #then the store changes nothing", () => {
    // given
    const f = expiredSession()
    f.store.tombstoneIfExpired(f.taskId, () => false, { pid: 11_001, token: "old-attempt" })
    expect(f.store.takeOverExpunging(f.taskId, { pid: 11_001, token: "old-attempt" }, { pid: 11_001, token: "new-attempt" })).toBe(true)

    // when
    const deleted = f.store.completeExpunge(f.taskId, { pid: 11_001, token: "old-attempt" })
    f.store.restoreExpunging(f.taskId, { pid: 11_001, token: "old-attempt" })

    // then
    expect(deleted).toBe(false)
    expect(tombstoned(f.store, f.taskId)).toBe(true)
    expect(f.store.readExpungeOwner(f.taskId)).toEqual({ pid: 11_001, token: "new-attempt" })
  })
})
