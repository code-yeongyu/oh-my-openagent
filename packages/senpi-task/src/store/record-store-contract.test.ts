// One contract, two stores: the DAG e2e ordering case (#11632) runs the real task manager on the in-memory
// record store, so a behaviour the file store has and the double lacks would let a manager regression pass
// there and fail in production. Each case runs against createTaskRecordStore in a temp project AND
// createInMemoryTaskRecordStore. Crash durability is not part of this contract: it stays owned by
// record-store.test.ts and the reconcile suites on the file store, and the double never claims it.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskRecord, type TaskRecord } from "../state"
import { createInMemoryTaskRecordStore } from "./__fixtures__/in-memory-record-store"
import { createTaskRecordStore } from "./record-store"
import { TaskRecordCollisionError } from "./record-write"
import { resolveStateDir } from "./state-dir"
import type { TaskRecordStore } from "./types"

const projects: string[] = []
afterAll(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true })
})

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), "task-record-contract-"))
  projects.push(directory)
  return directory
}

const stores: ReadonlyArray<readonly [string, () => TaskRecordStore]> = [
  ["file store", () => createTaskRecordStore({ project_dir: project() })],
  ["in-memory store", () => createInMemoryTaskRecordStore(resolveStateDir({ project_dir: project() }))],
]

const AT = "2026-11-20T00:00:00.000Z"
const OWNER = { pid: 4242, token: "attempt-a" }
const OTHER = { pid: 4343, token: "attempt-b" }

function record(taskId: string): TaskRecord {
  return {
    ...createTaskRecord({
      parent_session_id: "parent-session",
      root_session_id: "root-session",
      depth: 0,
      execution_mode: "direct",
      model: "test/model",
      notify_on_terminal: false,
    }),
    task_id: taskId,
  }
}

for (const [name, create] of stores) {
  describe(`task record store contract: ${name}`, () => {
    test("#given a saved record #when the same id is saved again #then it is refused as a collision", () => {
      const store = create()
      store.save(record("st_0000aaaa"))
      expect(() => store.save(record("st_0000aaaa"))).toThrow(TaskRecordCollisionError)
      expect(store.load("st_0000aaaa")?.task_id).toBe("st_0000aaaa")
    })

    test("#given records saved out of order #when listed #then they come back sorted by id with no diagnostics", () => {
      const store = create()
      store.save(record("st_0000bbbb"))
      store.save(record("st_0000aaaa"))
      const listed = store.list()
      expect(listed.records.map((entry) => entry.task_id)).toEqual(["st_0000aaaa", "st_0000bbbb"])
      expect(listed.diagnostics).toEqual([])
    })

    test("#given a mutation #when it returns its input or a patch #then only the patch is persisted", () => {
      const store = create()
      store.save(record("st_0000aaaa"))
      expect(store.mutate("st_0000aaaa", (current) => current)?.name).toBeUndefined()
      store.mutate("st_0000aaaa", (current) => ({ ...current, name: "renamed" }))
      expect(store.load("st_0000aaaa")?.name).toBe("renamed")
      expect(store.mutate("st_0000ffff", (current) => current)).toBeNull()
    })

    test("#given a pending record #when started then completed twice #then the late completion is audited and not applied", () => {
      const store = create()
      store.save(record("st_0000aaaa"))
      expect(store.transition("st_0000aaaa", { type: "start", timestamp: AT }).applied).toBe(true)
      expect(store.transition("st_0000aaaa", { type: "complete", timestamp: AT, final_response: "done" }).applied).toBe(
        true,
      )
      const late = store.transition("st_0000aaaa", { type: "complete", timestamp: AT, final_response: "again" })
      expect(late.applied).toBe(false)
      expect(store.load("st_0000aaaa")).toMatchObject({ status: "completed", final_response: "done" })
      expect(() => store.transition("st_0000ffff", { type: "start", timestamp: AT })).toThrow(/not found/)
    })

    test("#given an expired record #when tombstoned by an owner #then it is invisible and only that owner completes the expunge", () => {
      const store = create()
      store.save(record("st_0000aaaa"))
      expect(store.tombstoneIfExpired("st_0000aaaa", () => true).kind).toBe("retained")
      expect(store.tombstoneIfExpired("st_0000aaaa", () => false, OWNER).kind).toBe("tombstoned")
      expect(store.load("st_0000aaaa")).toBeNull()
      expect(store.list().records).toEqual([])
      expect(store.listExpunging()).toEqual(["st_0000aaaa"])
      expect(store.loadExpunging("st_0000aaaa")?.task_id).toBe("st_0000aaaa")
      expect(store.readExpungeOwner("st_0000aaaa")).toEqual(OWNER)
      expect(store.completeExpunge("st_0000aaaa", OTHER)).toBe(false)
      expect(store.completeExpunge("st_0000aaaa", OWNER)).toBe(true)
      expect(store.listExpunging()).toEqual([])
      expect(store.tombstoneIfExpired("st_0000aaaa", () => false).kind).toBe("missing")
    })

    test("#given a tombstone #when restored or taken over #then only the recorded owner can act", () => {
      const store = create()
      store.save(record("st_0000aaaa"))
      store.tombstoneIfExpired("st_0000aaaa", () => false, OWNER)
      expect(store.takeOverExpunging("st_0000aaaa", OTHER, OTHER)).toBe(false)
      expect(store.takeOverExpunging("st_0000aaaa", OWNER, OTHER)).toBe(true)
      expect(store.readExpungeOwner("st_0000aaaa")).toEqual(OTHER)
      store.restoreExpunging("st_0000aaaa", OWNER)
      expect(store.load("st_0000aaaa")).toBeNull()
      store.restoreExpunging("st_0000aaaa", OTHER)
      expect(store.load("st_0000aaaa")?.task_id).toBe("st_0000aaaa")
      expect(store.listExpunging()).toEqual([])
    })

    test("#given an unsafe task id #when loaded #then it is refused before any lookup", () => {
      const store = create()
      expect(() => store.load("../escape")).toThrow()
    })
  })
}
