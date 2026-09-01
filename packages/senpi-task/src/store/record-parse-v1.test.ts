import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { isSpawnSpecV1, type PendingSteeringEntry, type SpawnSpecV1, type TaskRecord } from "../state"
import { createTaskRecordStore, resolveStateDir } from "../store"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-parse-v1-"))
  cleanupRoots.push(directory)
  return directory
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

describe("record-parse notify_on_terminal legacy default", () => {
  test("#given a legacy record without notify_on_terminal #when listed #then the field defaults to false", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_02000001", {})

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]?.notify_on_terminal).toBe(false)
  })

  test("#given a record with notify_on_terminal true #when listed #then the field round-trips", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_02000002", { notify_on_terminal: true })

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]?.notify_on_terminal).toBe(true)
  })
})

describe("record-parse spawn_spec v1", () => {
  test("#given a legacy {cwd} spawn_spec #when listed #then it parses as the legacy variant (isSpawnSpecV1 false) with extensions/member_env dropped", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_02000003", {
      spawn_spec: {
        cwd: "/safe/project",
        extensions: ["/tmp/malicious.ts"],
        member_env: { MALICIOUS: "execute-me" },
      },
    })

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    const spec = result.records[0]?.spawn_spec
    expect(spec).toBeDefined()
    expect(isSpawnSpecV1(spec!)).toBe(false)
    expect(spec).toEqual({ cwd: "/safe/project" })
  })

  test("#given a v1 spawn_spec #when listed #then it round-trips with version, prompt, instructions, and member_scoped_tool_names", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const v1Spec: SpawnSpecV1 = {
      version: 1,
      cwd: "/project/child",
      prompt: "Fix the flaky test in auth.ts",
      instructions: "Use bun test, not jest",
      member_scoped_tool_names: ["read", "bash"],
    }
    writePersistedRecord(project, "st_02000004", { spawn_spec: v1Spec })

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    const spec = result.records[0]?.spawn_spec
    expect(spec).toBeDefined()
    expect(isSpawnSpecV1(spec!)).toBe(true)
    expect(spec).toEqual(v1Spec)
  })

  test("#given a v1 spawn_spec with only required fields #when listed #then it round-trips without optional fields", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const v1Minimal: SpawnSpecV1 = {
      version: 1,
      cwd: "/project/child",
      prompt: "Do the thing",
    }
    writePersistedRecord(project, "st_02000005", { spawn_spec: v1Minimal })

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]?.spawn_spec).toEqual(v1Minimal)
  })

  test("#given a spawn_spec missing cwd #when listed #then diagnostic is typed and record is skipped", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_02000006", {
      spawn_spec: { version: 1, prompt: "no cwd" },
    })

    // when
    const result = store.list()

    // then
    expect(result.records).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.type).toBe("parse_error")
  })

  test("#given a v1 spawn_spec missing prompt #when listed #then diagnostic is typed and record is skipped", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_02000007", {
      spawn_spec: { version: 1, cwd: "/project/child" },
    })

    // when
    const result = store.list()

    // then
    expect(result.records).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.type).toBe("parse_error")
  })
})

describe("record-parse pending_steering", () => {
  test("#given a valid pending_steering array #when listed #then it round-trips", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const steering: PendingSteeringEntry[] = [
      { id: "msg-1", message: "focus on the auth module", deliver_as: "steer" },
      { id: "msg-2", message: "also check the db layer", deliver_as: "followUp" },
    ]
    writePersistedRecord(project, "st_02000010", { pending_steering: steering })

    // when
    const result = store.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]?.pending_steering).toEqual(steering)
  })

  test("#given a malformed pending_steering entry #when listed #then the entry is dropped, siblings survive, AND the record remains in records with a parse_warning diagnostic", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const validEntry: PendingSteeringEntry = {
      id: "good-1",
      message: "survive",
      deliver_as: "steer",
    }
    writePersistedRecord(project, "st_02000011", {
      pending_steering: [
        validEntry,
        // malformed: missing id
        { message: "no id", deliver_as: "steer" },
        // malformed: bad deliver_as
        { id: "bad-deliver", message: "wrong type", deliver_as: "invalid" },
        // malformed: not an object
        "not-an-object",
        // malformed: missing message
        { id: "no-msg", deliver_as: "followUp" },
        // another valid entry after the bad ones
        { id: "good-2", message: "also survives", deliver_as: "followUp" },
      ],
    })

    // when
    const result = store.list()

    // then: record is STILL in records (whole-record rejection is banned)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.task_id).toBe("st_02000011")

    // the two valid entries survived
    const steering = result.records[0]?.pending_steering
    expect(steering).toBeDefined()
    expect(steering).toHaveLength(2)
    expect(steering![0]).toEqual(validEntry)
    expect(steering![1]).toEqual({ id: "good-2", message: "also survives", deliver_as: "followUp" })

    // a parse_warning diagnostic was appended naming the dropped entries
    const warnings = result.diagnostics.filter((d) => d.type === "parse_warning")
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    // the warning should name the path
    expect(warnings[0]?.path).toContain("st_02000011")
  })

  test("#given pending_steering that is not an array #when listed #then diagnostic is typed and record is skipped (whole-field corruption)", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_02000012", {
      pending_steering: "not-an-array",
    })

    // when
    const result = store.list()

    // then: whole-field corruption (not a single entry) is a parse_error
    expect(result.records).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.type).toBe("parse_error")
  })

  test("#given pending_steering that is an object not array #when listed #then diagnostic is typed and record is skipped", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_02000013", {
      pending_steering: { id: "wrong", message: "shape", deliver_as: "steer" },
    })

    // when
    const result = store.list()

    // then
    expect(result.records).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.type).toBe("parse_error")
  })

  test("#given a record with only malformed pending_steering entries #when listed #then record stays in records with warnings and empty steering", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_02000014", {
      pending_steering: [{ id: "bad", message: "ok", deliver_as: "invalid-type" }],
    })

    // when
    const result = store.list()

    // then: record survives, steering is empty/undefined, warning present
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.task_id).toBe("st_02000014")
    const steering = result.records[0]?.pending_steering
    // All entries dropped -> field omitted (empty)
    expect(steering === undefined || steering.length === 0).toBe(true)
    const warnings = result.diagnostics.filter((d) => d.type === "parse_warning")
    expect(warnings.length).toBeGreaterThanOrEqual(1)
  })
})

describe("record-parse pending_steering with sibling records", () => {
  test("#given one record with bad steering and one clean record #when listed #then both records survive, only the bad one has a warning", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    writePersistedRecord(project, "st_02000020", {
      pending_steering: [{ message: "no id", deliver_as: "steer" }],
    })
    writePersistedRecord(project, "st_02000021", {
      pending_steering: [{ id: "ok", message: "good", deliver_as: "steer" }],
    })

    // when
    const result = store.list()

    // then
    expect(result.records).toHaveLength(2)
    const ids = result.records.map((r: TaskRecord) => r.task_id).sort()
    expect(ids).toEqual(["st_02000020", "st_02000021"])

    // the clean record has no warnings
    const warnings = result.diagnostics.filter((d) => d.type === "parse_warning")
    expect(warnings.every((w) => w.path.includes("st_02000020"))).toBe(true)
    expect(warnings.some((w) => w.path.includes("st_02000021"))).toBe(false)
  })
})
