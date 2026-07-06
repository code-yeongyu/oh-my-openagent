import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import {
  createTaskRecord,
  createTaskRecordStore,
  resolveStateDir,
  transitionTaskRecord,
} from "../index"

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
    expect(stateDir).toBe("/tmp/project-a/.omo/senpi-task")
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
    const completed = transitionTaskRecord(record, {
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

  test("#given secret-like event payload #when event is appended #then jsonl payload is redacted", () => {
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
      payload: { apiKey: "secret", nested: { authorization: "Bearer secret" } },
    })

    // then
    const log = readFileSync(eventPath, "utf8")
    expect(log).toContain('"apiKey":"[REDACTED]"')
    expect(log).toContain('"authorization":"[REDACTED]"')
    expect(log).not.toContain("secret")
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

  test("#given completed record #when illegal running transition is persisted #then transition is rejected and completion remains", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const completed = transitionTaskRecord(
      createTaskRecord({
        parent_session_id: "parent-session",
        root_session_id: "root-session",
        depth: 0,
        execution_mode: "direct",
        model: "gpt-5.2",
      }),
      {
        type: "complete",
        timestamp: "2026-07-06T01:00:00.000Z",
        final_response: "done",
      },
    ).record
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
