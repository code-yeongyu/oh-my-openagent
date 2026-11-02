import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "./record-store"
import { resolveStateDir } from "./state-dir"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-store-figures-"))
  cleanupRoots.push(directory)
  return directory
}

function record(taskId: string) {
  return {
    ...createTaskRecord({
      parent_session_id: "parent-session",
      root_session_id: "root-session",
      depth: 0,
      execution_mode: "direct",
      model: "gpt-5.2",
      notify_on_terminal: false,
    }),
    task_id: taskId,
  }
}

// The memory report (oh-my-openagent#9442) reads what the store keeps resident: every record it has
// parsed stays cached until the file disappears, so its count and on-disk size are the layer's figures.
describe("createTaskRecordStore residentFigures", () => {
  test("#given two saved records #when the figures are read #then they count both cached records and their bytes", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.save(record("st_00000001"))
    store.save(record("st_00000002"))
    const tasksDir = join(resolveStateDir({ project_dir: project }), "tasks")
    const bytes = statSync(join(tasksDir, "st_00000001.json")).size + statSync(join(tasksDir, "st_00000002.json")).size

    // when
    const figures = store.residentFigures()

    // then
    expect(figures).toEqual({ cachedRecords: 2, cachedRecordBytes: bytes, openEventLogs: 0 })
  })

  test("#given a removed record #when the figures are read #then it no longer counts", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.save(record("st_00000003"))
    store.remove("st_00000003")

    // when
    const figures = store.residentFigures()

    // then
    expect(figures.cachedRecords).toBe(0)
    expect(figures.cachedRecordBytes).toBe(0)
  })
})
