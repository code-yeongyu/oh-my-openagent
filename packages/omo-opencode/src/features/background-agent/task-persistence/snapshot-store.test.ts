import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BackgroundTask } from "../types"
import { type PersistedTaskSnapshot, parseSnapshotFile } from "./snapshot-schema"
import { createTaskPersistenceStore } from "./snapshot-store"

const BOULDER_GITIGNORE_CONTENT = ["*", "!/rules/", "!/rules/**", ""].join("\n")

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "snapshot-store-"))
  tempDirs.push(dir)
  return dir
}

function tasksDir(directory: string): string {
  return join(directory, ".omo", "background-tasks")
}

function buildTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    parentSessionId: "ses_parent",
    parentMessageId: "msg_parent",
    description: "do a thing",
    prompt: "secret-prompt",
    agent: "sisyphus-junior",
    status: "running",
    ...overrides,
  }
}

function buildSnapshot(id: string, updatedAt: string): PersistedTaskSnapshot {
  return {
    schema_version: 1,
    id,
    description: "snap",
    agent: "sisyphus-junior",
    status: "completed",
    owner: { pid: process.pid, startedAt: "2026-06-12T10:00:00.000Z" },
    updatedAt,
  }
}

function makeRecordingLogger(): {
  logger: (message: string, data?: unknown) => void
  entries: string[]
} {
  const entries: string[] = []
  return {
    entries,
    logger: (message: string) => {
      entries.push(message)
    },
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("createTaskPersistenceStore persist", () => {
  it("writes a per-task json file with valid JSON, owning pid, and status", () => {
    // #given a store rooted at a fresh temp directory
    const directory = makeTempDir()
    const store = createTaskPersistenceStore({ directory })

    // #when persisting a running task
    store.persist(buildTask({ id: "task-persist", status: "running" }))

    // #then the per-task file exists and parses to a valid snapshot
    const filePath = join(tasksDir(directory), "task-persist.json")
    expect(existsSync(filePath)).toBe(true)
    const snapshot = parseSnapshotFile(readFileSync(filePath, "utf-8"))
    expect(snapshot?.id).toBe("task-persist")
    expect(snapshot?.status).toBe("running")
    expect(snapshot?.owner.pid).toBe(process.pid)
  })

  it("creates .omo/.gitignore with the boulder precedent content on a fresh dir", () => {
    // #given a fresh temp directory with no .omo
    const directory = makeTempDir()
    const store = createTaskPersistenceStore({ directory })

    // #when persisting a task (which provisions .omo)
    store.persist(buildTask())

    // #then a .gitignore is created mirroring the boulder precedent
    const gitignorePath = join(directory, ".omo", ".gitignore")
    expect(existsSync(gitignorePath)).toBe(true)
    expect(readFileSync(gitignorePath, "utf-8")).toBe(BOULDER_GITIGNORE_CONTENT)
  })

  it("leaves a pre-existing .omo/.gitignore untouched", () => {
    // #given a directory whose .omo already exists with custom gitignore content
    const directory = makeTempDir()
    const omoDir = join(directory, ".omo")
    mkdirSync(omoDir, { recursive: true })
    const gitignorePath = join(omoDir, ".gitignore")
    writeFileSync(gitignorePath, "custom-content\n", "utf-8")
    const store = createTaskPersistenceStore({ directory })

    // #when persisting a task
    store.persist(buildTask())

    // #then the existing gitignore is preserved
    expect(readFileSync(gitignorePath, "utf-8")).toBe("custom-content\n")
  })
})

describe("createTaskPersistenceStore delete", () => {
  it("removes the file and is idempotent when already missing", () => {
    // #given a persisted task
    const directory = makeTempDir()
    const store = createTaskPersistenceStore({ directory })
    store.persist(buildTask({ id: "task-del" }))
    const filePath = join(tasksDir(directory), "task-del.json")
    expect(existsSync(filePath)).toBe(true)

    // #when deleting it twice
    store.delete("task-del")
    store.delete("task-del")

    // #then the file is gone and no error is thrown
    expect(existsSync(filePath)).toBe(false)
  })
})

describe("createTaskPersistenceStore listSnapshots", () => {
  it("returns persisted entries and skips a hand-written garbage file while logging it", () => {
    // #given two persisted tasks and one garbage json file
    const directory = makeTempDir()
    const { logger, entries } = makeRecordingLogger()
    const store = createTaskPersistenceStore({ directory, logger })
    store.persist(buildTask({ id: "task-a" }))
    store.persist(buildTask({ id: "task-b" }))
    writeFileSync(join(tasksDir(directory), "garbage.json"), "{not valid json", "utf-8")

    // #when listing snapshots
    const snapshots = store.listSnapshots()

    // #then both valid entries are returned and the garbage entry was logged
    const ids = snapshots.map((snapshot) => snapshot.id).sort()
    expect(ids).toEqual(["task-a", "task-b"])
    expect(entries.length).toBeGreaterThan(0)
  })

  it("returns an empty array when the directory does not exist", () => {
    // #given a store over a directory that was never provisioned
    const directory = makeTempDir()
    const store = createTaskPersistenceStore({ directory })

    // #when listing snapshots
    // #then it returns an empty array
    expect(store.listSnapshots()).toEqual([])
  })
})

describe("createTaskPersistenceStore gcOlderThan", () => {
  it("deletes stale entries whose owner is dead", () => {
    // #given one stale and one fresh snapshot, both owned by a dead process
    const directory = makeTempDir()
    const store = createTaskPersistenceStore({ directory })
    const now = new Date("2026-06-12T12:00:00.000Z")
    store.persistSnapshot(buildSnapshot("task-stale", "2026-06-12T09:00:00.000Z"))
    store.persistSnapshot(buildSnapshot("task-fresh", "2026-06-12T11:59:00.000Z"))

    // #when running gc with a one-hour max age and the owner reported dead
    store.gcOlderThan(60 * 60 * 1000, now, () => false)

    // #then only the stale dead-owner entry is removed
    const remaining = store.listSnapshots().map((snapshot) => snapshot.id)
    expect(remaining).toEqual(["task-fresh"])
  })

  it("keeps a stale snapshot whose owner is still alive", () => {
    // #given a stale snapshot whose owner pid is reported alive
    const directory = makeTempDir()
    const store = createTaskPersistenceStore({ directory })
    const now = new Date("2026-06-12T12:00:00.000Z")
    store.persistSnapshot(buildSnapshot("task-stale", "2026-06-12T09:00:00.000Z"))

    // #when running gc with a one-hour max age and the owner reported alive
    store.gcOlderThan(60 * 60 * 1000, now, () => true)

    // #then the live sibling's snapshot survives regardless of age
    const remaining = store.listSnapshots().map((snapshot) => snapshot.id)
    expect(remaining).toEqual(["task-stale"])
  })

  it("deletes an unparseable file older than maxAge by mtime regardless of owner liveness", () => {
    // #given a fresh valid snapshot and an old unparseable file
    const directory = makeTempDir()
    const store = createTaskPersistenceStore({ directory })
    store.persistSnapshot(buildSnapshot("task-keep", "2026-06-12T11:59:00.000Z"))
    const garbage = join(tasksDir(directory), "garbage.json")
    writeFileSync(garbage, "{ not valid json", "utf-8")
    const oldTime = new Date("2020-01-01T00:00:00.000Z")
    utimesSync(garbage, oldTime, oldTime)
    const now = new Date("2026-06-12T12:00:00.000Z")

    // #when running gc with the owner reported alive (cannot fence unparseable files)
    store.gcOlderThan(60 * 60 * 1000, now, () => true)

    // #then the old unparseable file is deleted and the fresh snapshot is kept
    expect(existsSync(garbage)).toBe(false)
    expect(store.listSnapshots().map((snapshot) => snapshot.id)).toEqual(["task-keep"])
  })
})

describe("createTaskPersistenceStore resilience", () => {
  it("does not throw when the target directory is actually a file path", () => {
    // #given a store whose directory points at a regular file
    const parent = makeTempDir()
    const filePath = join(parent, "not-a-dir")
    writeFileSync(filePath, "i am a file", "utf-8")
    const { logger, entries } = makeRecordingLogger()
    const store = createTaskPersistenceStore({ directory: filePath, logger })

    // #when persisting into the unwritable location
    // #then no error escapes and the failure is logged
    expect(() => store.persist(buildTask())).not.toThrow()
    expect(entries.length).toBeGreaterThan(0)
  })
})
