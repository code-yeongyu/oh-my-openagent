import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
      notify_on_terminal: false,
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
      model_id: "gpt-5.6-luna-fast",
      display: "openai/gpt-5.6-luna-fast",
    }
    writer.save({ ...baseRecord("st_00000007"), resolved_model: resolvedModel })
    const reader = createTaskRecordStore({ project_dir: project })

    // when
    const result = reader.list()

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.records[0]?.resolved_model).toEqual(resolvedModel)
  })

  test("#given a persisted liveness delivery epoch #when a fresh store reads the task #then the epoch round-trips", () => {
    // given
    const project = tempProject()
    const writer = createTaskRecordStore({ project_dir: project })
    const record = baseRecord("st_00000008")
    writer.save({
      ...record,
      notification: { ...record.notification, liveness_notified_epoch: 0 },
    })
    const reader = createTaskRecordStore({ project_dir: project })

    // when
    const loaded = reader.load(record.task_id)

    // then
    expect(loaded?.notification.liveness_notified_epoch).toBe(0)
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

  test("#given a concurrent lifecycle write #when a serialized conditional patch runs #then it re-reads fresh state and preserves every lifecycle field", () => {
    const project = tempProject()
    const writer = createTaskRecordStore({ project_dir: project })
    const patcher = createTaskRecordStore({ project_dir: project })
    const record = baseRecord("st_00000009")
    writer.save(record)
    const advanced = {
      ...record,
      status: "running" as const,
      name: "revived-member",
      notification: { ...record.notification, run_epoch: 1 },
    }
    writer.replace(advanced)

    patcher.mutate(record.task_id, (fresh) => {
      if (fresh.status !== record.status || fresh.notification.run_epoch !== record.notification.run_epoch) return fresh
      return {
        ...fresh,
        notification: { ...fresh.notification, liveness_notified_epoch: record.notification.run_epoch },
      }
    })

    expect(writer.load(record.task_id)).toEqual(advanced)
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

describe("createTaskRecordStore remove artifacts", () => {
  const TASK_ID = "st_00000010"

  function seedFullArtifactSet(project: string): string {
    const store = createTaskRecordStore({ project_dir: project })
    store.save(baseRecord(TASK_ID))
    store.appendEvent(TASK_ID, { type: "created", payload: {} })

    const stateDir = resolveStateDir({ project_dir: project })

    // children/<taskId>/sessions/<taskId>/x.jsonl
    const childDir = join(stateDir, "children", TASK_ID, "sessions", TASK_ID)
    mkdirSync(childDir, { recursive: true })
    writeFileSync(join(childDir, "x.jsonl"), "{\"role\":\"user\",\"content\":\"hi\"}\n", "utf8")

    // completion-results/<taskId>.txt
    const spillDir = join(stateDir, "completion-results")
    mkdirSync(spillDir, { recursive: true })
    writeFileSync(join(spillDir, `${TASK_ID}.txt`), "spilled final response", "utf8")

    return stateDir
  }

  test("#given a record + event log + children dir + spill file #when remove is called #then ALL FOUR artifacts are deleted", () => {
    // given
    const project = tempProject()
    const stateDir = seedFullArtifactSet(project)
    const store = createTaskRecordStore({ project_dir: project })

    const recordPath = join(stateDir, "tasks", `${TASK_ID}.json`)
    const logPath = join(stateDir, "logs", `${TASK_ID}.jsonl`)
    const childDir = join(stateDir, "children", TASK_ID)
    const spillPath = join(stateDir, "completion-results", `${TASK_ID}.txt`)

    expect(existsSync(recordPath)).toBe(true)
    expect(existsSync(logPath)).toBe(true)
    expect(existsSync(childDir)).toBe(true)
    expect(existsSync(spillPath)).toBe(true)

    // when
    store.remove(TASK_ID)

    // then
    expect(existsSync(recordPath)).toBe(false)
    expect(existsSync(logPath)).toBe(false)
    expect(existsSync(childDir)).toBe(false)
    expect(existsSync(spillPath)).toBe(false)
  })

  test("#given a partially-cleaned task (children dir already gone) #when remove is called #then it still deletes log + record without throwing", () => {
    // given
    const project = tempProject()
    const stateDir = seedFullArtifactSet(project)
    // simulate a partial cleanup: children dir already removed
    rmSync(join(stateDir, "children", TASK_ID), { recursive: true, force: true })

    const store = createTaskRecordStore({ project_dir: project })
    const recordPath = join(stateDir, "tasks", `${TASK_ID}.json`)
    const logPath = join(stateDir, "logs", `${TASK_ID}.jsonl`)
    const spillPath = join(stateDir, "completion-results", `${TASK_ID}.txt`)

    expect(existsSync(recordPath)).toBe(true)
    expect(existsSync(logPath)).toBe(true)
    expect(existsSync(spillPath)).toBe(true)

    // when
    store.remove(TASK_ID)

    // then
    expect(existsSync(recordPath)).toBe(false)
    expect(existsSync(logPath)).toBe(false)
    expect(existsSync(spillPath)).toBe(false)
  })

  test("#given a fully removed task #when remove is called again #then it is a no-op without throwing", () => {
    // given
    const project = tempProject()
    const stateDir = seedFullArtifactSet(project)
    const store = createTaskRecordStore({ project_dir: project })
    store.remove(TASK_ID)

    const recordPath = join(stateDir, "tasks", `${TASK_ID}.json`)
    const logPath = join(stateDir, "logs", `${TASK_ID}.jsonl`)
    const childDir = join(stateDir, "children", TASK_ID)
    const spillPath = join(stateDir, "completion-results", `${TASK_ID}.txt`)

    expect(existsSync(recordPath)).toBe(false)
    expect(existsSync(logPath)).toBe(false)
    expect(existsSync(childDir)).toBe(false)
    expect(existsSync(spillPath)).toBe(false)

    // when
    expect(() => store.remove(TASK_ID)).not.toThrow()

    // then - everything still gone
    expect(existsSync(recordPath)).toBe(false)
    expect(existsSync(logPath)).toBe(false)
    expect(existsSync(childDir)).toBe(false)
    expect(existsSync(spillPath)).toBe(false)
  })
})

describe("createTaskRecordStore tombstone expunge", () => {
  const TASK_ID = "st_00000030"

  function seedTombstoneCandidate(project: string): { store: ReturnType<typeof createTaskRecordStore>; stateDir: string } {
    const store = createTaskRecordStore({ project_dir: project })
    store.save(baseRecord(TASK_ID))
    store.appendEvent(TASK_ID, { type: "created", payload: {} })
    const stateDir = resolveStateDir({ project_dir: project })
    mkdirSync(join(stateDir, "children", TASK_ID), { recursive: true })
    const spillDir = join(stateDir, "completion-results")
    mkdirSync(spillDir, { recursive: true })
    writeFileSync(join(spillDir, `${TASK_ID}.txt`), "spilled final response", "utf8")
    return { store, stateDir }
  }

  test("#given the retention predicate rejects the record #when tombstoneIfExpired runs #then the record is renamed to a tombstone invisible to load, list, and mutate", () => {
    // given
    const project = tempProject()
    const { store, stateDir } = seedTombstoneCandidate(project)
    const taskRecordPath = join(stateDir, "tasks", `${TASK_ID}.json`)
    const tombstonePath = `${taskRecordPath}.expunging`
    // a stray non-task tombstone name must never enter the expunge pipeline
    writeFileSync(join(stateDir, "tasks", "not-a-task.json.expunging"), "{}", "utf8")

    // when
    const result = store.tombstoneIfExpired(TASK_ID, () => false)

    // then the atomic rename commits the record to deletion and no claim can take it
    if (result.kind !== "tombstoned") throw new Error("expected tombstoned")
    expect(result.record.task_id).toBe(TASK_ID)
    expect(existsSync(taskRecordPath)).toBe(false)
    expect(existsSync(tombstonePath)).toBe(true)
    expect(store.load(TASK_ID)).toBeNull()
    expect(store.list().records).toHaveLength(0)
    expect(store.mutate(TASK_ID, (record) => record)).toBeNull()
    expect(store.listExpunging()).toEqual([TASK_ID])
  })

  test("#given the retention predicate keeps the record #when tombstoneIfExpired runs #then the record is untouched", () => {
    // given
    const project = tempProject()
    const { store, stateDir } = seedTombstoneCandidate(project)
    const taskRecordPath = join(stateDir, "tasks", `${TASK_ID}.json`)

    // when
    const result = store.tombstoneIfExpired(TASK_ID, () => true)

    // then
    expect(result.kind).toBe("retained")
    expect(existsSync(taskRecordPath)).toBe(true)
    expect(existsSync(`${taskRecordPath}.expunging`)).toBe(false)
    expect(store.load(TASK_ID)?.task_id).toBe(TASK_ID)
  })

  test("#given a missing record #when tombstoneIfExpired runs #then it reports missing without writing anything", () => {
    // given
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })

    // when
    const result = store.tombstoneIfExpired(TASK_ID, () => false)

    // then
    expect(result.kind).toBe("missing")
    expect(store.listExpunging()).toEqual([])
  })

  test("#given a tombstoned record with leftover artifacts #when completeExpunge runs #then children dir, spill, log, and tombstone are gone and a re-run is a no-op", () => {
    // given
    const project = tempProject()
    const { store, stateDir } = seedTombstoneCandidate(project)
    store.tombstoneIfExpired(TASK_ID, () => false)
    const tombstonePath = join(stateDir, "tasks", `${TASK_ID}.json.expunging`)
    expect(existsSync(tombstonePath)).toBe(true)

    // when
    store.completeExpunge(TASK_ID)

    // then
    expect(existsSync(tombstonePath)).toBe(false)
    expect(existsSync(join(stateDir, "children", TASK_ID))).toBe(false)
    expect(existsSync(join(stateDir, "completion-results", `${TASK_ID}.txt`))).toBe(false)
    expect(existsSync(join(stateDir, "logs", `${TASK_ID}.jsonl`))).toBe(false)
    expect(store.listExpunging()).toEqual([])

    // when run again (crash-recovery idempotence)
    expect(() => store.completeExpunge(TASK_ID)).not.toThrow()

    // then everything is still gone
    expect(existsSync(tombstonePath)).toBe(false)
  })
})
