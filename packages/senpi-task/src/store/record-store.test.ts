import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-store-"))
  cleanupRoots.push(directory)
  return directory
}

function baseRecord(taskId: string) {
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

describe("createTaskRecordStore caching", () => {
  test("#given an agent-resolved record #when a fresh store reads it #then source agent round-trips without diagnostics", () => {
    // given
    const project = tempProject()
    const writer = createTaskRecordStore({ project_dir: project })
    const resolvedModel = {
      source: "agent" as const,
      provider: "openai",
      model_id: "gpt-5.4-mini-fast",
      display: "openai/gpt-5.4-mini-fast",
    }
    writer.save({ ...baseRecord("st_00000007"), resolved_model: resolvedModel })
    const reader = createTaskRecordStore({ project_dir: project })

    // when
    const result = reader.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]?.resolved_model).toEqual(resolvedModel)
  })

  test("#given unchanged records #when list() is called repeatedly #then results stay consistent", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const ids = Array.from({ length: 5 }, (_, index) => `st_${String(index + 1).padStart(8, "0")}`)
    for (const taskId of ids) store.save(baseRecord(taskId))

    // when
    const first = store.list().records.map((record) => record.task_id).sort()
    const second = store.list().records.map((record) => record.task_id).sort()

    // then
    expect(second).toEqual(first)
  })

  test("#given an externally mutated record #when list() runs #then the change is reflected", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const idA = "st_00000001"
    const idB = "st_00000002"
    store.save(baseRecord(idA))
    store.save(baseRecord(idB))
    store.list() // warm cache

    const stateDir = resolveStateDir({ project_dir: project })
    const pathA = join(stateDir, "tasks", `${idA}.json`)
    const rawA = JSON.parse(readFileSync(pathA, "utf8")) as { name: string }
    writeFileSync(pathA, JSON.stringify({ ...rawA, name: "mutated-A" }), "utf8")

    // when
    const result = store.list()

    // then
    expect(result.records.find((record) => record.task_id === idA)?.name).toBe("mutated-A")
    expect(result.records.find((record) => record.task_id === idB)?.name).not.toBe("mutated-A")
  })

  test("#given a record removed by another process #when list() runs #then it disappears from results", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.save(baseRecord("st_00000003"))
    store.list() // warm cache

    const stateDir = resolveStateDir({ project_dir: project })
    rmSync(join(stateDir, "tasks", "st_00000003.json"), { force: true })

    // when
    const result = store.list()

    // then
    expect(result.records).toHaveLength(0)
  })

  test("#given a record replaced through the store #when list() runs #then the cache reflects the new value", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const record = baseRecord("st_00000004")
    store.save(record)
    store.list() // warm cache

    // when
    store.replace({ ...record, name: "replaced" })
    const result = store.list()

    // then
    expect(result.records[0]?.name).toBe("replaced")
  })
})

describe("createTaskRecordStore event append", () => {
  test("#given a removed task #when appendEvent is called again #then the log file is recreated", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    store.save(baseRecord("st_00000005"))
    store.appendEvent("st_00000005", { type: "before", payload: {} })
    store.remove("st_00000005")

    // when
    store.appendEvent("st_00000005", { type: "after", payload: {} })

    // then
    const stateDir = resolveStateDir({ project_dir: project })
    const logPath = join(stateDir, "logs", "st_00000005.jsonl")
    const lines = readFileSync(logPath, "utf8").trim().split("\n")
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? "{}").type).toBe("after")
  })

  test("#given a record save #when the file is read back #then it is compact JSON without pretty-print indentation", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const record = baseRecord("st_00000006")

    // when
    store.save(record)

    // then
    const stateDir = resolveStateDir({ project_dir: project })
    const raw = readFileSync(join(stateDir, "tasks", "st_00000006.json"), "utf8")
    expect(raw).not.toContain("\n  ")
    expect(JSON.parse(raw).task_id).toBe("st_00000006")
  })
})
