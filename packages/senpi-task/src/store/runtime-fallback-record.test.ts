import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "./record-store"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("task record runtime fallback metadata", () => {
  test("#given requested and ordered fallback models #when a task record round-trips #then the chain remains intact", () => {
    // given
    const project = mkdtempSync(join(tmpdir(), "senpi-task-runtime-fallback-record-"))
    cleanupRoots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const requestedModel = {
      source: "category",
      provider: "kimi-coding",
      model_id: "kimi-for-coding-highspeed-unlocked",
      display: "kimi-coding/kimi-for-coding-highspeed-unlocked",
      reasoning_effort: "minimal",
    } as const
    const fallbackModels = [
      {
        source: "category",
        provider: "quotio-openai",
        model_id: "gpt-5.4-mini-fast",
        display: "quotio-openai/gpt-5.4-mini-fast",
        reasoning_effort: "minimal",
      },
    ] as const
    const input = {
      parent_session_id: "parent-1",
      root_session_id: "parent-1",
      depth: 1,
      execution_mode: "in-process",
      model: requestedModel.display,
      requested_model: requestedModel,
      fallback_models: fallbackModels,
      resolved_model: requestedModel,
    }
    const record = createTaskRecord(input)
    store.save(record)

    // when
    const loaded = createTaskRecordStore({ project_dir: project }).list()

    // then
    expect(loaded.diagnostics).toEqual([])
    expect(loaded.records[0]).toMatchObject({
      requested_model: requestedModel,
      fallback_models: fallbackModels,
    })
  })
})
