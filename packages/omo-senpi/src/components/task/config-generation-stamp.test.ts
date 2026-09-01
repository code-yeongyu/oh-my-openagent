import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskRecord, createTaskRecordStore, type TaskRecord, type TaskRecordStore } from "@oh-my-opencode/senpi-task"

import { createConfigGenerationStampingStore } from "./config-generation-store"

const projects: string[] = []

afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function backingStore(): TaskRecordStore {
  const project = mkdtempSync(join(tmpdir(), "omo-senpi-config-generation-"))
  projects.push(project)
  return createTaskRecordStore({ project_dir: project })
}

function draft(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...createTaskRecord({
      parent_session_id: "parent-1",
      root_session_id: "parent-1",
      depth: 0,
      execution_mode: "in-process",
      model: "anthropic/claude-opus-5",
      notify_on_terminal: false,
    }),
    ...overrides,
  }
}

describe("config generation stamping store", () => {
  test("#given a known planning generation #when a fresh record is saved #then it persists that generation", () => {
    // given
    const backing = backingStore()
    const store = createConfigGenerationStampingStore(backing, () => 2)
    const record = draft()

    // when
    store.save(record)

    // then
    expect(backing.load(record.task_id)?.config_generation).toBe(2)
  })

  test("#given a record already carrying a generation #when it is saved #then the persisted generation is left alone", () => {
    // given
    const backing = backingStore()
    const store = createConfigGenerationStampingStore(backing, () => 5)
    const record = draft({ config_generation: 1 })

    // when
    store.save(record)

    // then
    expect(backing.load(record.task_id)?.config_generation).toBe(1)
  })

  test("#given no planning generation yet #when a record is saved #then no generation is persisted", () => {
    // given
    const backing = backingStore()
    const store = createConfigGenerationStampingStore(backing, () => undefined)
    const record = draft()

    // when
    store.save(record)

    // then
    expect(backing.load(record.task_id)?.config_generation).toBeUndefined()
  })

  test("#given a claimed record whose in-memory copy lost the stamp #when it is replaced while a newer generation is current #then the persisted generation survives", () => {
    // given
    const backing = backingStore()
    let generation = 3
    const store = createConfigGenerationStampingStore(backing, () => generation)
    const record = draft()
    store.save(record)
    generation = 9

    // when
    store.replace({ ...record, status: "running", name: "renamed" })

    // then
    expect(backing.load(record.task_id)?.config_generation).toBe(3)
  })

  test("#given a stamping store #when replace and transition run #then the record passes through unchanged apart from the transition", () => {
    // given
    const backing = backingStore()
    const store = createConfigGenerationStampingStore(backing, () => 7)
    const record = draft()
    store.save(record)

    // when
    store.replace({ ...record, config_generation: 7, status: "running", name: "renamed" })
    const result = store.transition(record.task_id, {
      type: "complete",
      timestamp: "2026-08-21T00:05:00.000Z",
      final_response: "done",
    })

    // then
    expect(result.record.status).toBe("completed")
    expect(result.record.name).toBe("renamed")
    expect(backing.load(record.task_id)?.config_generation).toBe(7)
  })
})
