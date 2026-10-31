import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "./record-store"
import { TaskRecordWriteError } from "./record-error"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(platform: NodeJS.Platform, code: string, heldUntil: number, status: "pending" | "running" = "pending") {
  const project = mkdtempSync(join(tmpdir(), "task-record-contention-"))
  roots.push(project)
  let now = 0
  let attempts = 0
  const waits: number[] = []
  const refusal = Object.assign(new Error("synthetic record contention"), { code })
  const store = createTaskRecordStore({ project_dir: project }, {
    platform,
    rename: (from, to) => {
      attempts += 1
      if (now < heldUntil && String(to).endsWith(".json")) throw refusal
      renameSync(from, to)
    },
    sleep: (ms) => { waits.push(ms); now += ms },
  })
  const record = { ...createTaskRecord({
    parent_session_id: "parent", root_session_id: "root", depth: 1,
    execution_mode: "in-process", model: "test/model", notify_on_terminal: false,
  }), status }
  store.save(record)
  return { project, store, record, waits, refusal, attempts: () => attempts, elapsed: () => now, release: () => { heldUntil = 0 } }
}

test.each(["replace", "mutate", "start", "complete"] as const)(
  "#given a 500 ms Windows holder #when %s writes a record #then it persists beyond the old 40 ms budget",
  (operation) => {
    // given
    const { project, store, record, waits, elapsed } = fixture("win32", "EPERM", 500, operation === "complete" ? "running" : "pending")
    const timestamp = "2026-10-25T00:00:00.000Z"
    // when
    if (operation === "replace") store.replace({ ...record, name: "updated" })
    else if (operation === "mutate") store.mutate(record.task_id, fresh => ({ ...fresh, name: "updated" }))
    else if (operation === "start") store.transition(record.task_id, { type: "start", timestamp })
    else store.transition(record.task_id, { type: "complete", timestamp, final_response: "done" })
    // then
    const persisted = createTaskRecordStore({ project_dir: project }).load(record.task_id)
    if (operation === "replace" || operation === "mutate") expect(persisted?.name).toBe("updated")
    else expect(persisted?.status).toBe(operation === "start" ? "running" : "completed")
    expect(elapsed()).toBeGreaterThanOrEqual(500)
    expect(elapsed()).toBeLessThanOrEqual(2_000)
    expect(waits.every((ms, index) => index === 0 || ms > (waits[index - 1] ?? 0))).toBe(true)
    expect(readdirSync(join(store.stateDir, "tasks")).filter(file => file.endsWith(".tmp"))).toEqual([])
  },
)

test.each(["EPERM", "EBUSY", "EACCES"])(
  "#given permanent Windows %s #when replacing #then it gives up within two seconds and cleans temporary files",
  (code) => {
    // given
    const { store, record, refusal, elapsed } = fixture("win32", code, Infinity)
    // when
    let caught: unknown
    try { store.replace({ ...record, name: "unwritten" }) } catch (error) { caught = error }
    // then
    expect(caught).toBeInstanceOf(TaskRecordWriteError)
    if (!(caught instanceof TaskRecordWriteError)) throw new Error("expected exhausted Windows write")
    expect(caught.cause).toBe(refusal)
    expect(elapsed()).toBeGreaterThanOrEqual(1_000)
    expect(elapsed()).toBeLessThanOrEqual(2_000)
    expect(store.load(record.task_id)?.name).toBe(record.name)
    expect(readdirSync(join(store.stateDir, "tasks")).filter(file => file.endsWith(".tmp"))).toEqual([])
  },
)

test.each([["darwin", "EPERM"], ["win32", "EIO"], ["win32", "ENOENT"]] as const)(
  "#given %s %s #when replacing #then it fails immediately without retry",
  (platform, code) => {
    // given
    const { store, record, refusal, waits, attempts } = fixture(platform, code, Infinity)
    // when / then
    expect(() => store.replace({ ...record, name: "unwritten" })).toThrow(refusal)
    expect(attempts()).toBe(1)
    expect(waits).toEqual([])
  },
)

test.each(["remove", "expunge"] as const)("#given a cached pending record with a held target #when its spawn fails #then readers see terminal failure and %s removes the marker", (cleanup) => {
  // given
  const { project, store, record, release } = fixture("win32", "EPERM", Infinity)
  const reader = createTaskRecordStore({ project_dir: project })
  expect(reader.load(record.task_id)?.status).toBe("pending")
  // when
  store.markSpawnFailed(record)
  // then
  expect(reader.load(record.task_id)?.status).toBe("error")
  expect(createTaskRecordStore({ project_dir: project }).load(record.task_id)?.residency_state).toBe("disposed")
  expect(reader.list().records[0]?.status).toBe("error")
  expect(store.transition(record.task_id, { type: "start", timestamp: "2026-10-25T00:00:00.000Z" }).applied).toBe(false)
  release()
  if (cleanup === "remove") store.remove(record.task_id)
  else {
    store.tombstoneIfExpired(record.task_id, () => false)
    expect(store.loadExpunging(record.task_id)?.status).toBe("error")
    store.completeExpunge(record.task_id)
  }
  expect(readdirSync(join(store.stateDir, "tasks"))).toEqual([])
})

test("#given a task claimed by another owner #when an obsolete spawn fails #then it cannot mark the current record failed", () => {
  // given
  const { store, record } = fixture("win32", "EPERM", 0)
  store.replace({ ...record, host_pid: process.pid })
  // when
  const current = store.markSpawnFailed(record)
  // then
  expect(current?.status).toBe("pending")
  expect(existsSync(join(store.stateDir, "tasks", `${record.task_id}.json.spawn-failed`))).toBe(false)
})

test("#given a failed start write #when reading the audit #then no unapplied start event is published", () => {
  // given
  const { store, record } = fixture("win32", "EPERM", Infinity)
  // when
  expect(() => store.transition(record.task_id, { type: "start", timestamp: "2026-10-25T00:00:00.000Z" })).toThrow()
  // then
  expect(store.load(record.task_id)?.status).toBe("pending")
  expect(existsSync(join(store.stateDir, "logs", `${record.task_id}.jsonl`))).toBe(false)
})
