import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { join, basename } from "path"
import { z } from "zod"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import {
  getTaskDir,
  readJsonSafe,
  writeJsonAtomic,
  acquireLock,
  generateTaskId,
  listTaskFiles,
  resolveTaskListId,
  sanitizePathSegment,
} from "./storage"
import type { OhMyOpenCodeConfig } from "../../config/schema"

const TEST_DIR = ".test-claude-tasks"
const TEST_DIR_ABS = join(process.cwd(), TEST_DIR)

describe("getTaskDir", () => {
  const originalTaskListId = process.env.ULTRAWORK_TASK_LIST_ID
  const originalClaudeTaskListId = process.env.CLAUDE_CODE_TASK_LIST_ID

  beforeEach(() => {
    if (originalTaskListId === undefined) {
      delete process.env.ULTRAWORK_TASK_LIST_ID
    } else {
      process.env.ULTRAWORK_TASK_LIST_ID = originalTaskListId
    }

    if (originalClaudeTaskListId === undefined) {
      delete process.env.CLAUDE_CODE_TASK_LIST_ID
    } else {
      process.env.CLAUDE_CODE_TASK_LIST_ID = originalClaudeTaskListId
    }
  })

  afterEach(() => {
    if (originalTaskListId === undefined) {
      delete process.env.ULTRAWORK_TASK_LIST_ID
    } else {
      process.env.ULTRAWORK_TASK_LIST_ID = originalTaskListId
    }

    if (originalClaudeTaskListId === undefined) {
      delete process.env.CLAUDE_CODE_TASK_LIST_ID
    } else {
      process.env.CLAUDE_CODE_TASK_LIST_ID = originalClaudeTaskListId
    }
  })

  test("returns global config path for default config", () => {
    //#given
    const config: Partial<OhMyOpenCodeConfig> = {}
    const configDir = getOpenCodeConfigDir({ binary: "opencode" })
    const expectedListId = sanitizePathSegment(basename(process.cwd()))

    //#when
    const result = getTaskDir(config)

    //#then
    expect(result).toBe(join(configDir, "tasks", expectedListId))
  })

  test("respects ULTRAWORK_TASK_LIST_ID env var", () => {
    //#given
    process.env.ULTRAWORK_TASK_LIST_ID = "custom list/id"
    const configDir = getOpenCodeConfigDir({ binary: "opencode" })

    //#when
    const result = getTaskDir()

    //#then
    expect(result).toBe(join(configDir, "tasks", "custom-list-id"))
  })

  test("respects CLAUDE_CODE_TASK_LIST_ID env var when ULTRAWORK_TASK_LIST_ID not set", () => {
    //#given
    delete process.env.ULTRAWORK_TASK_LIST_ID
    process.env.CLAUDE_CODE_TASK_LIST_ID = "claude list/id"
    const configDir = getOpenCodeConfigDir({ binary: "opencode" })

    //#when
    const result = getTaskDir()

    //#then
    expect(result).toBe(join(configDir, "tasks", "claude-list-id"))
  })

  test("falls back to sanitized cwd basename when env var not set", () => {
    //#given
    delete process.env.ULTRAWORK_TASK_LIST_ID
    const configDir = getOpenCodeConfigDir({ binary: "opencode" })
    const expectedListId = sanitizePathSegment(basename(process.cwd()))

    //#when
    const result = getTaskDir()

    //#then
    expect(result).toBe(join(configDir, "tasks", expectedListId))
  })

  test("returns absolute storage_path without joining cwd", () => {
    //#given
    const config: Partial<OhMyOpenCodeConfig> = {
      sisyphus: {
        tasks: {
          storage_path: "/tmp/custom-task-path",
          claude_code_compat: false,
        },
      },
    }

    //#when
    const result = getTaskDir(config)

    //#then
    expect(result).toBe("/tmp/custom-task-path")
  })

  test("joins relative storage_path with cwd", () => {
    //#given
    const config: Partial<OhMyOpenCodeConfig> = {
      sisyphus: {
        tasks: {
          storage_path: ".custom/tasks",
          claude_code_compat: false,
        },
      },
    }

    //#when
    const result = getTaskDir(config)

    //#then
    expect(result).toBe(join(process.cwd(), ".custom/tasks"))
  })
})

describe("resolveTaskListId", () => {
  const originalTaskListId = process.env.ULTRAWORK_TASK_LIST_ID
  const originalClaudeTaskListId = process.env.CLAUDE_CODE_TASK_LIST_ID

  beforeEach(() => {
    if (originalTaskListId === undefined) {
      delete process.env.ULTRAWORK_TASK_LIST_ID
    } else {
      process.env.ULTRAWORK_TASK_LIST_ID = originalTaskListId
    }

    if (originalClaudeTaskListId === undefined) {
      delete process.env.CLAUDE_CODE_TASK_LIST_ID
    } else {
      process.env.CLAUDE_CODE_TASK_LIST_ID = originalClaudeTaskListId
    }
  })

  afterEach(() => {
    if (originalTaskListId === undefined) {
      delete process.env.ULTRAWORK_TASK_LIST_ID
    } else {
      process.env.ULTRAWORK_TASK_LIST_ID = originalTaskListId
    }

    if (originalClaudeTaskListId === undefined) {
      delete process.env.CLAUDE_CODE_TASK_LIST_ID
    } else {
      process.env.CLAUDE_CODE_TASK_LIST_ID = originalClaudeTaskListId
    }
  })

  test("returns env var when set", () => {
    //#given
    process.env.ULTRAWORK_TASK_LIST_ID = "custom-list"

    //#when
    const result = resolveTaskListId()

    //#then
    expect(result).toBe("custom-list")
  })

  test("returns CLAUDE_CODE_TASK_LIST_ID when ULTRAWORK_TASK_LIST_ID not set", () => {
    //#given
    delete process.env.ULTRAWORK_TASK_LIST_ID
    process.env.CLAUDE_CODE_TASK_LIST_ID = "claude-list"

    //#when
    const result = resolveTaskListId()

    //#then
    expect(result).toBe("claude-list")
  })

  test("sanitizes CLAUDE_CODE_TASK_LIST_ID special characters", () => {
    //#given
    delete process.env.ULTRAWORK_TASK_LIST_ID
    process.env.CLAUDE_CODE_TASK_LIST_ID = "claude list/id"

    //#when
    const result = resolveTaskListId()

    //#then
    expect(result).toBe("claude-list-id")
  })

  test("sanitizes special characters", () => {
    //#given
    process.env.ULTRAWORK_TASK_LIST_ID = "custom list/id"

    //#when
    const result = resolveTaskListId()

    //#then
    expect(result).toBe("custom-list-id")
  })

  test("returns sanitized cwd basename when env var not set", () => {
    //#given
    delete process.env.ULTRAWORK_TASK_LIST_ID
    const expected = sanitizePathSegment(basename(process.cwd()))

    //#when
    const result = resolveTaskListId()

    //#then
    expect(result).toBe(expected)
  })
})

describe("generateTaskId", () => {
  test("generates task ID with T- prefix and UUID", () => {
    //#when
    const taskId = generateTaskId()

    //#then
    expect(taskId).toMatch(/^T-[a-f0-9-]{36}$/)
  })

  test("generates unique task IDs", () => {
    //#when
    const id1 = generateTaskId()
    const id2 = generateTaskId()

    //#then
    expect(id1).not.toBe(id2)
  })
})

describe("listTaskFiles", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) {
      rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) {
      rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    }
  })

  test("returns empty array for non-existent directory", () => {
    //#given
    const config: Partial<OhMyOpenCodeConfig> = {
      new_task_system_enabled: false,
      sisyphus: { tasks: { storage_path: TEST_DIR, claude_code_compat: false } }
    }

    //#when
    const result = listTaskFiles(config)

    //#then
    expect(result).toEqual([])
  })

  test("returns empty array for directory with no task files", () => {
    //#given
    const config: Partial<OhMyOpenCodeConfig> = {
      new_task_system_enabled: false,
      sisyphus: { tasks: { storage_path: TEST_DIR, claude_code_compat: false } }
    }
    mkdirSync(TEST_DIR_ABS, { recursive: true })
    writeFileSync(join(TEST_DIR_ABS, "other.json"), "{}", "utf-8")

    //#when
    const result = listTaskFiles(config)

    //#then
    expect(result).toEqual([])
  })

  test("lists task files with T- prefix and .json extension", () => {
    //#given
    const config: Partial<OhMyOpenCodeConfig> = {
      new_task_system_enabled: false,
      sisyphus: { tasks: { storage_path: TEST_DIR, claude_code_compat: false } }
    }
    mkdirSync(TEST_DIR_ABS, { recursive: true })
    writeFileSync(join(TEST_DIR_ABS, "T-abc123.json"), "{}", "utf-8")
    writeFileSync(join(TEST_DIR_ABS, "T-def456.json"), "{}", "utf-8")
    writeFileSync(join(TEST_DIR_ABS, "other.json"), "{}", "utf-8")
    writeFileSync(join(TEST_DIR_ABS, "notes.md"), "# notes", "utf-8")

    //#when
    const result = listTaskFiles(config)

    //#then
    expect(result).toHaveLength(2)
    expect(result).toContain("T-abc123")
    expect(result).toContain("T-def456")
  })

  test("returns task IDs without .json extension", () => {
    //#given
    const config: Partial<OhMyOpenCodeConfig> = {
      new_task_system_enabled: false,
      sisyphus: { tasks: { storage_path: TEST_DIR, claude_code_compat: false } }
    }
    mkdirSync(TEST_DIR_ABS, { recursive: true })
    writeFileSync(join(TEST_DIR_ABS, "T-test-id.json"), "{}", "utf-8")

    //#when
    const result = listTaskFiles(config)

    //#then
    expect(result[0]).toBe("T-test-id")
    expect(result[0]).not.toContain(".json")
  })
})

describe("readJsonSafe", () => {
  const testSchema = z.object({
    id: z.string(),
    value: z.number(),
  })

  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) {
      rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR_ABS, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) {
      rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    }
  })

  test("returns null for non-existent file", () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "nonexistent.json")

    //#when
    const result = readJsonSafe(filePath, testSchema)

    //#then
    expect(result).toBeNull()
  })

  test("returns parsed data for valid file", () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "valid.json")
    const data = { id: "test", value: 42 }
    writeFileSync(filePath, JSON.stringify(data), "utf-8")

    //#when
    const result = readJsonSafe(filePath, testSchema)

    //#then
    expect(result).toEqual(data)
  })

  test("returns null for invalid JSON", () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "invalid.json")
    writeFileSync(filePath, "{ invalid json", "utf-8")

    //#when
    const result = readJsonSafe(filePath, testSchema)

    //#then
    expect(result).toBeNull()
  })

  test("returns null for data that fails schema validation", () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "invalid-schema.json")
    const data = { id: "test", value: "not-a-number" }
    writeFileSync(filePath, JSON.stringify(data), "utf-8")

    //#when
    const result = readJsonSafe(filePath, testSchema)

    //#then
    expect(result).toBeNull()
  })
})

describe("writeJsonAtomic", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) {
      rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) {
      rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    }
  })

  test("creates directory if it does not exist", () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "nested", "dir", "file.json")
    const data = { test: "data" }

    //#when
    writeJsonAtomic(filePath, data)

    //#then
    expect(existsSync(filePath)).toBe(true)
  })

  test("writes data atomically", async () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "atomic.json")
    const data = { id: "test", value: 123 }

    //#when
    writeJsonAtomic(filePath, data)

    //#then
    expect(existsSync(filePath)).toBe(true)
    const content = await Bun.file(filePath).text()
    expect(JSON.parse(content)).toEqual(data)
  })

  test("overwrites existing file", async () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "overwrite.json")
    mkdirSync(TEST_DIR_ABS, { recursive: true })
    writeFileSync(filePath, JSON.stringify({ old: "data" }), "utf-8")

    //#when
    const newData = { new: "data" }
    writeJsonAtomic(filePath, newData)

    //#then
    const content = await Bun.file(filePath).text()
    expect(JSON.parse(content)).toEqual(newData)
  })
})

describe("acquireLock", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) {
      rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR_ABS, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) {
      rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    }
  })

  test("acquires lock when no lock exists", () => {
    //#given
    const dirPath = TEST_DIR_ABS

    //#when
    const lock = acquireLock(dirPath)

    //#then
    expect(lock.acquired).toBe(true)
    expect(existsSync(join(dirPath, ".lock"))).toBe(true)

    //#cleanup
    lock.release()
  })

  test("fails to acquire lock when fresh lock exists", () => {
    //#given
    const dirPath = TEST_DIR
    const firstLock = acquireLock(dirPath)

    //#when
    const secondLock = acquireLock(dirPath)

    //#then
    expect(secondLock.acquired).toBe(false)

    //#cleanup
    firstLock.release()
  })

  test("acquires lock when stale lock exists (>30s)", () => {
    //#given
    const dirPath = TEST_DIR
    const lockPath = join(dirPath, ".lock")
    const staleTimestamp = Date.now() - 31000 // 31 seconds ago
    writeFileSync(lockPath, JSON.stringify({ timestamp: staleTimestamp }), "utf-8")

    //#when
    const lock = acquireLock(dirPath)

    //#then
    expect(lock.acquired).toBe(true)

    //#cleanup
    lock.release()
  })

  test("release removes lock file", () => {
    //#given
    const dirPath = TEST_DIR
    const lock = acquireLock(dirPath)
    const lockPath = join(dirPath, ".lock")

    //#when
    lock.release()

    //#then
    expect(existsSync(lockPath)).toBe(false)
  })

  test("release is safe to call multiple times", () => {
    //#given
    const dirPath = TEST_DIR
    const lock = acquireLock(dirPath)

    //#when
    lock.release()
    lock.release()

    //#then
    expect(existsSync(join(dirPath, ".lock"))).toBe(false)
  })
})
