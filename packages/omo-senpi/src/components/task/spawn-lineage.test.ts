import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import {
  SENPI_TASK_LINEAGE_TASK_ID_ENV,
  createTaskRecord,
  createTaskRecordStore,
} from "@oh-my-opencode/senpi-task"

import { createStoredSpawnLineageResolver } from "./spawn-lineage"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-lineage-"))
  roots.push(root)
  return root
}

describe("stored Senpi spawn lineage", () => {
  test("#given no child lineage marker #when resolving root session #then root coordinator facts are explicit", () => {
    const store = createTaskRecordStore({ project_dir: project() })
    const resolve = createStoredSpawnLineageResolver({ store, omoConfig: {}, env: {} })

    expect(resolve("root-session")).toEqual({
      depth: 0,
      rootSessionId: "root-session",
      lineage: "known",
      callerRole: "coordinator",
    })
  })

  test("#given a durable worker record #when resolving child session #then stored policy bounds apply", () => {
    const store = createTaskRecordStore({ project_dir: project() })
    const record = createTaskRecord({
      parent_session_id: "root-session",
      root_session_id: "root-session",
      depth: 1,
      execution_mode: "process",
      model: "openai/gpt-5.6-sol",
      agent_type: "planner",
      spawn_role: "worker",
    })
    store.save({ ...record, child_session_id: "child-session" })
    const resolve = createStoredSpawnLineageResolver({
      store,
      omoConfig: { agents: { planner: { max_depth: 2, allowed_subagents: ["worker"] } } },
      env: { [SENPI_TASK_LINEAGE_TASK_ID_ENV]: record.task_id },
    })

    expect(resolve("child-session")).toEqual({
      depth: 1,
      rootSessionId: "root-session",
      lineage: "known",
      callerRole: "worker",
      callerMaxDepth: 2,
      allowedSubagents: ["worker"],
    })
  })

  test("#given a stale child session #when resolving #then lineage fails closed", () => {
    const store = createTaskRecordStore({ project_dir: project() })
    const record = createTaskRecord({
      parent_session_id: "root-session",
      root_session_id: "root-session",
      depth: 1,
      execution_mode: "process",
      model: "openai/gpt-5.6-sol",
      spawn_role: "worker",
    })
    store.save({ ...record, child_session_id: "old-child-session" })
    const resolve = createStoredSpawnLineageResolver({
      store,
      omoConfig: {},
      env: { [SENPI_TASK_LINEAGE_TASK_ID_ENV]: record.task_id },
    })

    expect(resolve("injected-session")).toEqual({
      depth: 0,
      rootSessionId: "injected-session",
      lineage: "unknown",
      callerRole: "leaf",
    })
  })
})
