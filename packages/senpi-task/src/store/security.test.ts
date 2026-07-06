import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { createTaskRecord, createTaskRecordStore, resolveStateDir } from "../index"
import type { TaskRecord } from "../index"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-security-"))
  cleanupRoots.push(directory)
  return directory
}

function taskWithId(taskId: string): TaskRecord {
  return {
    ...createTaskRecord({
      parent_session_id: "parent-session",
      root_session_id: "root-session",
      depth: 0,
      execution_mode: "direct",
      model: "gpt-5.2",
    }),
    task_id: taskId,
  }
}

function writePersistedRecord(project: string, taskId: string, fields: Record<string, unknown>): string {
  const tasksDir = join(resolveStateDir({ project_dir: project }), "tasks")
  const path = join(tasksDir, `${taskId}.json`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify({
      task_id: taskId,
      status: "pending",
      residency_state: "resident",
      parent_session_id: "parent-session",
      root_session_id: "root-session",
      depth: 0,
      execution_mode: "direct",
      model: "gpt-5.2",
      created_at: "2026-07-06T00:00:00.000Z",
      updated_at: "2026-07-06T00:00:00.000Z",
      notification: {
        run_epoch: 0,
        notified_epoch: -1,
      },
      ...fields,
    }),
    "utf8",
  )
  return path
}

describe("TaskRecordStore task id boundary", () => {
  test("#given hostile task ids #when public path entry points are called #then ids are rejected before writing", () => {
    // given
    const project = tempProject()
    const outsidePath = join(project, "outside-write.jsonl")
    const store = createTaskRecordStore({ project_dir: project })
    const hostileIds = [
      "../outside-write",
      "nested/../../outside-write",
      join(project, "outside-write"),
      "file://outside-write",
      "st_12345678%2foutside-write",
      "st_12345678\\outside-write",
    ]

    // when
    for (const taskId of hostileIds) {
      expect(() => store.save(taskWithId(taskId))).toThrow("Invalid task id")
      expect(() => store.load(taskId)).toThrow("Invalid task id")
      expect(() => store.appendEvent(taskId, { type: "probe", payload: {} })).toThrow("Invalid task id")
      expect(() =>
        store.transition(taskId, {
          type: "start",
          timestamp: "2026-07-06T00:00:00.000Z",
          pid: 1234,
        }),
      ).toThrow("Invalid task id")
    }

    // then
    expect(existsSync(outsidePath)).toBe(false)
    expect(readdirSync(project)).not.toContain("outside-write.jsonl")
  })
})

describe("parseTaskRecord persisted boundary", () => {
  test("#given malformed optional pid #when records are listed #then diagnostic is typed and record is skipped", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const path = writePersistedRecord(project, "st_bad00001", { pid: "not-a-number" })

    // when
    const result = store.list()

    // then
    expect(result.records).toEqual([])
    expect(result.diagnostics).toEqual([
      {
        type: "parse_error",
        path,
        message: "pid is not a number",
      },
    ])
  })

  test("#given malformed optional tool allow #when records are listed #then diagnostic is typed and record is skipped", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const path = writePersistedRecord(project, "st_bad00002", { tool_allow: ["read", 1234] })

    // when
    const result = store.list()

    // then
    expect(result.records).toEqual([])
    expect(result.diagnostics).toEqual([
      {
        type: "parse_error",
        path,
        message: "tool_allow is not a string array",
      },
    ])
  })

  test("#given invalid enum sentinel #when diagnostic is reported #then raw rejected value is redacted", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const invalidStatus = "invalid-enum-sentinel"
    writePersistedRecord(project, "st_bad00003", { status: invalidStatus })

    // when
    const result = store.list()
    const message = result.diagnostics[0]?.message ?? ""

    // then
    expect(result.records).toEqual([])
    expect(message).toContain("[REDACTED]")
    expect(message).not.toContain(invalidStatus)
  })
})
