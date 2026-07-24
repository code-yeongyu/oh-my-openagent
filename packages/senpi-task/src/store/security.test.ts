import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { createTaskRecord, type ResolvedModelRecord, type TaskRecord } from "../state"
import { createTaskRecordStore, resolveStateDir } from "../store"

const cleanupRoots: string[] = []
const RESOLVED_MODEL = {
  provider: "openai",
  model_id: "gpt-5.6-sol",
  display: "OpenAI GPT-5.6 SOL",
  source: "category",
} as const satisfies ResolvedModelRecord

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
  test("#given an old persisted record without resolved model metadata #when listed #then the record remains valid", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_01d00001", {})

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]?.resolved_model).toBeUndefined()
  })

  test("#given persisted resolved model metadata #when listed #then structured metadata survives the parse round-trip", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const resolvedModel = { ...RESOLVED_MODEL, variant: "high", reasoning_effort: "medium" }
    writePersistedRecord(project, "st_01d00002", { resolved_model: resolvedModel })

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]?.resolved_model).toEqual(resolvedModel)
  })

  test("#given persisted resolved model metadata with a future field #when listed #then known metadata is parsed and the future field is ignored", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_01d00003", { resolved_model: { ...RESOLVED_MODEL, capabilities: ["vision"] } })

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]?.resolved_model).toEqual(RESOLVED_MODEL)
  })

  test("#given malformed resolved model metadata #when listed #then diagnostic is typed and record is skipped", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const path = writePersistedRecord(project, "st_01d00004", {
      resolved_model: { ...RESOLVED_MODEL, source: "assistant" },
    })

    // when
    const result = store.list()

    // then
    expect(result.records).toEqual([])
    expect(result.diagnostics).toEqual([{ type: "parse_error", path, message: "resolved_model.source must be category or explicit or agent" }])
  })

  test("#given malformed known resolved model fields #when listed #then diagnostic is typed and record is skipped", () => {
    // given
    const cases = [
      { taskId: "st_bad0a01", fields: { provider: 1234 }, message: "provider is not a string" },
      { taskId: "st_bad0a02", fields: { model_id: 1234 }, message: "model_id is not a string" },
      { taskId: "st_bad0a03", fields: { display: 1234 }, message: "display is not a string" },
      { taskId: "st_bad0a04", fields: { reasoning_effort: 1234 }, message: "reasoning_effort is not a string" },
    ]

    for (const testCase of cases) {
      const project = tempProject()
      const store = createTaskRecordStore({ project_dir: project })
      const path = writePersistedRecord(project, testCase.taskId, {
        resolved_model: { ...RESOLVED_MODEL, reasoning_effort: "medium", source: "explicit", ...testCase.fields },
      })

      // when
      const result = store.list()

      // then
      expect(result.records).toEqual([])
      expect(result.diagnostics).toEqual([{ type: "parse_error", path, message: testCase.message }])
    }
  })
  test("#given persisted launch inputs #when listed #then they are discarded", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_01d00006", {
      spawn_spec: {
        cwd: "/safe/project",
        extensions: ["/tmp/malicious-extension.ts"],
        member_env: { MALICIOUS_MEMBER_ENV: "execute-me" },
      },
    })

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]).not.toHaveProperty("spawn_spec")
  })

  test("#given a persisted killed:true error record #when listed #then the killed FACT survives the parse round-trip", () => {
    // given: a subsequent residency transition (dispose) reloads through the parser, so killed must be preserved
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_deadbee1", { status: "error", killed: true, error_message: "RPC child killed by signal SIGKILL" })

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]?.killed).toBe(true)
  })

  test("#given a persisted non-boolean killed #when listed #then a typed diagnostic is reported", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const path = writePersistedRecord(project, "st_deadbee2", { killed: "yes" })

    // when
    const result = store.list()

    // then
    expect(result.records).toEqual([])
    expect(result.diagnostics).toEqual([{ type: "parse_error", path, message: "killed is not a boolean" }])
  })

  test("#given malformed optional pid #when records are listed #then diagnostic is typed and record is skipped", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const path = writePersistedRecord(project, "st_bad00001", { pid: "not-a-number" })

    // when
    const result = store.list()

    // then
    expect(result.records).toEqual([])
    expect(result.diagnostics).toEqual([{ type: "parse_error", path, message: "pid is not a number" }])
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
    expect(result.diagnostics).toEqual([{ type: "parse_error", path, message: "tool_allow is not a string array" }])
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

describe("createTaskRecord privacy boundary", () => {
  test("#given runtime task input with prompt-shaped extras #when created and saved #then extras are not copied into the record or store", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const runtimeInput = { ...taskWithId("st_01d00005"), prompt: "do not persist this prompt", messages: ["do not persist this message"] }

    // when
    const record = createTaskRecord(runtimeInput)
    store.save(record)
    const persisted = readFileSync(join(resolveStateDir({ project_dir: project }), "tasks", `${record.task_id}.json`), "utf8")

    // then
    expect("prompt" in record).toBe(false)
    expect("messages" in record).toBe(false)
    expect(persisted).not.toContain("prompt")
    expect(persisted).not.toContain("messages")
    expect(persisted).not.toContain("do not persist")
  })
})
