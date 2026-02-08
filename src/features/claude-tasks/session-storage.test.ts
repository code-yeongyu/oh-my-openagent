import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "fs"
import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import {
  getSessionTaskDir,
  listSessionTaskFiles,
  listAllSessionDirs,
  findTaskAcrossSessions,
} from "./session-storage"

const TEST_DIR = ".test-session-storage"
const TEST_DIR_ABS = join(process.cwd(), TEST_DIR)

function makeConfig(storagePath: string): Partial<OhMyOpenCodeConfig> {
  return {
    sisyphus: {
      tasks: { storage_path: storagePath, claude_code_compat: false },
    },
  }
}

describe("getSessionTaskDir", () => {
  test("returns session-scoped subdirectory under base task dir", () => {
    //#given
    const config = makeConfig("/tmp/tasks")
    const sessionID = "ses_abc123"

    //#when
    const result = getSessionTaskDir(config, sessionID)

    //#then
    expect(result).toBe("/tmp/tasks/ses_abc123")
  })

  test("uses relative storage path joined with cwd", () => {
    //#given
    const config = makeConfig(TEST_DIR)
    const sessionID = "ses_xyz"

    //#when
    const result = getSessionTaskDir(config, sessionID)

    //#then
    expect(result).toBe(join(TEST_DIR_ABS, "ses_xyz"))
  })
})

describe("listSessionTaskFiles", () => {
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

  test("returns empty array when session directory does not exist", () => {
    //#given
    const config = makeConfig(TEST_DIR)

    //#when
    const result = listSessionTaskFiles(config, "nonexistent-session")

    //#then
    expect(result).toEqual([])
  })

  test("lists only T-*.json files in the session directory", () => {
    //#given
    const config = makeConfig(TEST_DIR)
    const sessionDir = join(TEST_DIR_ABS, "ses_001")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, "T-aaa.json"), "{}", "utf-8")
    writeFileSync(join(sessionDir, "T-bbb.json"), "{}", "utf-8")
    writeFileSync(join(sessionDir, "other.txt"), "nope", "utf-8")

    //#when
    const result = listSessionTaskFiles(config, "ses_001")

    //#then
    expect(result).toHaveLength(2)
    expect(result).toContain("T-aaa")
    expect(result).toContain("T-bbb")
  })

  test("does not list tasks from other sessions", () => {
    //#given
    const config = makeConfig(TEST_DIR)
    const session1Dir = join(TEST_DIR_ABS, "ses_001")
    const session2Dir = join(TEST_DIR_ABS, "ses_002")
    mkdirSync(session1Dir, { recursive: true })
    mkdirSync(session2Dir, { recursive: true })
    writeFileSync(join(session1Dir, "T-from-s1.json"), "{}", "utf-8")
    writeFileSync(join(session2Dir, "T-from-s2.json"), "{}", "utf-8")

    //#when
    const result = listSessionTaskFiles(config, "ses_001")

    //#then
    expect(result).toEqual(["T-from-s1"])
  })
})

describe("listAllSessionDirs", () => {
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

  test("returns empty array when base directory does not exist", () => {
    //#given
    const config = makeConfig(TEST_DIR)

    //#when
    const result = listAllSessionDirs(config)

    //#then
    expect(result).toEqual([])
  })

  test("returns only directory entries (not files)", () => {
    //#given
    const config = makeConfig(TEST_DIR)
    mkdirSync(TEST_DIR_ABS, { recursive: true })
    mkdirSync(join(TEST_DIR_ABS, "ses_001"), { recursive: true })
    mkdirSync(join(TEST_DIR_ABS, "ses_002"), { recursive: true })
    writeFileSync(join(TEST_DIR_ABS, ".lock"), "{}", "utf-8")
    writeFileSync(join(TEST_DIR_ABS, "T-legacy.json"), "{}", "utf-8")

    //#when
    const result = listAllSessionDirs(config)

    //#then
    expect(result).toHaveLength(2)
    expect(result).toContain("ses_001")
    expect(result).toContain("ses_002")
  })
})

describe("findTaskAcrossSessions", () => {
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

  test("returns null when task does not exist in any session", () => {
    //#given
    const config = makeConfig(TEST_DIR)
    mkdirSync(join(TEST_DIR_ABS, "ses_001"), { recursive: true })

    //#when
    const result = findTaskAcrossSessions(config, "T-nonexistent")

    //#then
    expect(result).toBeNull()
  })

  test("finds task in the correct session directory", () => {
    //#given
    const config = makeConfig(TEST_DIR)
    const session2Dir = join(TEST_DIR_ABS, "ses_002")
    mkdirSync(join(TEST_DIR_ABS, "ses_001"), { recursive: true })
    mkdirSync(session2Dir, { recursive: true })
    writeFileSync(join(session2Dir, "T-target.json"), '{"id":"T-target"}', "utf-8")

    //#when
    const result = findTaskAcrossSessions(config, "T-target")

    //#then
    expect(result).not.toBeNull()
    expect(result!.sessionID).toBe("ses_002")
    expect(result!.path).toBe(join(session2Dir, "T-target.json"))
  })

  test("returns null when base directory does not exist", () => {
    //#given
    const config = makeConfig(TEST_DIR)

    //#when
    const result = findTaskAcrossSessions(config, "T-any")

    //#then
    expect(result).toBeNull()
  })
})
