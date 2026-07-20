import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import {
  TaskRecordCollisionError,
  createTaskRecord,
  createTaskRecordStore,
  resolveStateDir,
  transitionTaskRecord,
} from "../index"
import { parseTaskId } from "./id"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-store-"))
  cleanupRoots.push(directory)
  return directory
}

describe("resolveStateDir", () => {
  test("#given no task state override #when resolved #then project omo senpi-task directory is used", () => {
    // given
    const project = "/tmp/project-a"

    // when
    const stateDir = resolveStateDir({ project_dir: project })

    // then
    expect(stateDir).toBe(join(project, ".omo", "senpi-task"))
  })

  test("#given task state override #when resolved #then override directory wins", () => {
    // given
    const project = "/tmp/project-a"

    // when
    const stateDir = resolveStateDir({ project_dir: project, task: { state_dir: "/tmp/custom-state" } })

    // then
    expect(stateDir).toBe("/tmp/custom-state")
  })
})

describe("TaskRecordStore", () => {
  test("#given completed task record #when saved and reloaded #then durable task facts are identical", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const record = createTaskRecord({
      name: "Summarize logs",
      parent_session_id: "parent-session",
      root_session_id: "root-session",
      depth: 2,
      agent_type: "sisyphus",
      execution_mode: "background",
      model: "gpt-5.2",
      tool_allow: ["read", "bash"],
      tool_deny: ["write"],
    })
    const running = transitionTaskRecord(record, {
      type: "start",
      timestamp: "2026-07-06T00:59:59.000Z",
      pid: 9876,
    }).record
    const completed = transitionTaskRecord(running, {
      type: "complete",
      timestamp: "2026-07-06T01:00:00.000Z",
      final_response: "done",
    }).record

    // when
    store.save(completed)
    const reloaded = store.load(completed.task_id)

    // then
    expect(reloaded).toEqual(completed)
  })

  test("#given sensitive event payload #when event is appended #then jsonl payload is redacted", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const record = createTaskRecord({
      parent_session_id: "parent-session",
      root_session_id: "root-session",
      depth: 0,
      execution_mode: "direct",
      model: "gpt-5.2",
    })
    store.save(record)

    // when
    const eventPath = store.appendEvent(record.task_id, {
      type: "senpi_api",
      payload: { apiKey: "redaction-sentinel", nested: { authorization: "Bearer redaction-sentinel" } },
    })

    // then
    const log = readFileSync(eventPath, "utf8")
    expect(log).toContain('"apiKey":"[REDACTED]"')
    expect(log).toContain('"authorization":"[REDACTED]"')
    expect(log).not.toContain("redaction-sentinel")
  })

  test("#given corrupt task json #when records are listed #then typed diagnostic is reported and corrupt record is skipped", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const good = createTaskRecord({
      parent_session_id: "parent-session",
      root_session_id: "root-session",
      depth: 0,
      execution_mode: "direct",
      model: "gpt-5.2",
    })
    store.save(good)
    const tasksDir = join(resolveStateDir({ project_dir: project }), "tasks")
    mkdirSync(tasksDir, { recursive: true })
    writeFileSync(join(tasksDir, "st_badbeef.json"), "{not-json", "utf8")

    // when
    const result = store.list()

    // then
    expect(result.records.map((record) => record.task_id)).toEqual([good.task_id])
    expect(result.diagnostics).toEqual([
      {
        type: "parse_error",
        path: join(tasksDir, "st_badbeef.json"),
        message: expect.stringContaining("JSON"),
      },
    ])
  })

  test("#given duplicate generated task id #when a different record is saved #then existing task file is not overwritten", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const original = createTaskRecord({
      parent_session_id: "parent-session",
      root_session_id: "root-session",
      depth: 0,
      execution_mode: "direct",
      model: "gpt-5.2",
    })
    const duplicate = {
      ...createTaskRecord({
        parent_session_id: "other-parent-session",
        root_session_id: "root-session",
        depth: 0,
        execution_mode: "direct",
        model: "gpt-5.2",
      }),
      task_id: original.task_id,
    }
    store.save(original)

    // when
    let collision: TaskRecordCollisionError | undefined
    try {
      store.save(duplicate)
    } catch (error) {
      if (!(error instanceof TaskRecordCollisionError)) throw error
      collision = error
    }

    // then
    expect(collision).toBeInstanceOf(TaskRecordCollisionError)
    expect(collision?.taskId).toBe(parseTaskId(original.task_id))
    expect(store.load(original.task_id)).toEqual(original)
  })

  test("#given completed record #when illegal running transition is persisted #then transition is rejected and completion remains", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const running = transitionTaskRecord(
      createTaskRecord({
        parent_session_id: "parent-session",
        root_session_id: "root-session",
        depth: 0,
        execution_mode: "direct",
        model: "gpt-5.2",
      }),
      {
        type: "start",
        timestamp: "2026-07-06T00:59:59.000Z",
        pid: 9876,
      },
    ).record
    const completed = transitionTaskRecord(running, {
      type: "complete",
      timestamp: "2026-07-06T01:00:00.000Z",
      final_response: "done",
    }).record
    store.save(completed)

    // when
    const rejected = store.transition(completed.task_id, {
      type: "start",
      timestamp: "2026-07-06T01:00:01.000Z",
      pid: 1234,
    })

    // then
    expect(rejected.applied).toBe(false)
    expect(store.load(completed.task_id)?.status).toBe("completed")
  })
})
