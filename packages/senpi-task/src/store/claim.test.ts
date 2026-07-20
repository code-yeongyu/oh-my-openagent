import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import type { TaskRecord } from "../state"
import { claimTaskRecord } from "./claim"
import { TaskRecordCollisionError, createTaskRecordStore } from "./record-store"
import { resolveStateDir } from "./state-dir"

const cleanupRoots: string[] = []
const claimFloorChildFixturePath = resolve(import.meta.dir, "__fixtures__", "claim-floor-child.ts")

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-claim-"))
  cleanupRoots.push(directory)
  return directory
}

function baseRecord(taskId: string, name = taskId): TaskRecord {
  return {
    task_id: taskId,
    name,
    status: "pending",
    residency_state: "resident",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 0,
    execution_mode: "in-process",
    model: "test/model",
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
}

describe("claimTaskRecord", () => {
  test("#given consecutive persisted records #when a colliding draft is claimed #then it saves the next available record", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.save(baseRecord("st_00000010"))
    store.save(baseRecord("st_00000011"))

    // when
    const claimed = claimTaskRecord(store, baseRecord("st_00000010"))

    // then
    expect(claimed.task_id).toBe("st_00000012")
    expect(existsSync(join(resolveStateDir({ project_dir: project }), "tasks", "st_00000012.json"))).toBe(true)
  })

  test("#given more collisions than the attempt limit #when a draft is claimed #then the final collision propagates", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.save(baseRecord("st_00000010"))
    store.save(baseRecord("st_00000011"))
    store.save(baseRecord("st_00000012"))

    // when
    const claim = () => claimTaskRecord(store, baseRecord("st_00000010"), { maxAttempts: 2 })

    // then
    expect(claim).toThrow(TaskRecordCollisionError)
  })

  test("#given a name derived from its id #when the draft is bumped with nameFollowsId #then its name follows the claimed id", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.save(baseRecord("st_00000010"))

    // when
    const claimed = claimTaskRecord(store, baseRecord("st_00000010"), { nameFollowsId: true })

    // then
    expect(claimed.name).toBe(claimed.task_id)
  })

  test("#given a task-id-shaped requested name #when the draft is bumped without nameFollowsId #then its name is preserved verbatim", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.save(baseRecord("st_00000010"))

    // when
    const claimed = claimTaskRecord(store, baseRecord("st_00000010", "st_00000010"))

    // then
    expect(claimed.task_id).toBe("st_00000011")
    expect(claimed.name).toBe("st_00000010")
  })

  test("#given a store that raises a non-collision error #when a draft is claimed #then the error propagates unwrapped", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const expected = new TypeError("store unavailable")
    const failingStore = { ...store, save: () => { throw expected } }

    // when
    const claim = () => claimTaskRecord(failingStore, baseRecord("st_00000010"))

    // then
    expect(claim).toThrow(expected)
  })

  test("#given a claimed record in an isolated process #when a new id is created #then the id floor follows the claim", async () => {
    // given
    const child = Bun.spawn([process.execPath, claimFloorChildFixturePath], { stdout: "pipe", stderr: "pipe" })

    // when
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    // then
    expect(exitCode, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0)
  })
})
