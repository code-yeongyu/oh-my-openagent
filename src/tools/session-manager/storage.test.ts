import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const TEST_DIR = join(tmpdir(), "omo-test-session-manager")
const TEST_MESSAGE_STORAGE = join(TEST_DIR, "message")
const TEST_PART_STORAGE = join(TEST_DIR, "part")
const TEST_SESSION_STORAGE = join(TEST_DIR, "session")
const TEST_TODO_DIR = join(TEST_DIR, "todos")
const TEST_TRANSCRIPT_DIR = join(TEST_DIR, "transcripts")

mock.module("./constants", () => ({
  OPENCODE_STORAGE: TEST_DIR,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: TEST_PART_STORAGE,
  SESSION_STORAGE: TEST_SESSION_STORAGE,
  TODO_DIR: TEST_TODO_DIR,
  TRANSCRIPT_DIR: TEST_TRANSCRIPT_DIR,
  SESSION_LIST_DESCRIPTION: "test",
  SESSION_READ_DESCRIPTION: "test",
  SESSION_SEARCH_DESCRIPTION: "test",
  SESSION_INFO_DESCRIPTION: "test",
  SESSION_DELETE_DESCRIPTION: "test",
  TOOL_NAME_PREFIX: "session_",
}))

const { getAllSessions, getMessageDir, sessionExists, readSessionMessages, readSessionTodos, getSessionInfo } =
  await import("./storage")

const storage = await import("./storage")

describe("session-manager storage", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_MESSAGE_STORAGE, { recursive: true })
    mkdirSync(TEST_PART_STORAGE, { recursive: true })
    mkdirSync(TEST_SESSION_STORAGE, { recursive: true })
    mkdirSync(TEST_TODO_DIR, { recursive: true })
    mkdirSync(TEST_TRANSCRIPT_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  test("getAllSessions returns empty array when no sessions exist", async () => {
    // #when
    const sessions = await getAllSessions()

    // #then
    expect(Array.isArray(sessions)).toBe(true)
    expect(sessions).toEqual([])
  })

  test("getMessageDir finds session in direct path", () => {
    // #given
    const sessionID = "ses_test123"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })
    writeFileSync(join(sessionPath, "msg_001.json"), JSON.stringify({ id: "msg_001", role: "user" }))

    // #when
    const result = getMessageDir(sessionID)

    // #then
    expect(result).toBe(sessionPath)
  })

  test("sessionExists returns false for non-existent session", () => {
    // #when
    const exists = sessionExists("ses_nonexistent")

    // #then
    expect(exists).toBe(false)
  })

  test("sessionExists returns true for existing session", () => {
    // #given
    const sessionID = "ses_exists"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })
    writeFileSync(join(sessionPath, "msg_001.json"), JSON.stringify({ id: "msg_001" }))

    // #when
    const exists = sessionExists(sessionID)

    // #then
    expect(exists).toBe(true)
  })

  test("readSessionMessages returns empty array for non-existent session", async () => {
    // #when
    const messages = await readSessionMessages("ses_nonexistent")

    // #then
    expect(messages).toEqual([])
  })

  test("readSessionMessages sorts messages by timestamp", async () => {
    // #given
    const sessionID = "ses_test123"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })

    writeFileSync(
      join(sessionPath, "msg_002.json"),
      JSON.stringify({ id: "msg_002", role: "assistant", time: { created: 2000 } })
    )
    writeFileSync(
      join(sessionPath, "msg_001.json"),
      JSON.stringify({ id: "msg_001", role: "user", time: { created: 1000 } })
    )

    // #when
    const messages = await readSessionMessages(sessionID)

    // #then
    expect(messages.length).toBe(2)
    expect(messages[0].id).toBe("msg_001")
    expect(messages[1].id).toBe("msg_002")
  })

  test("readSessionTodos returns empty array when no todos exist", async () => {
    // #when
    const todos = await readSessionTodos("ses_nonexistent")

    // #then
    expect(todos).toEqual([])
  })

  test("getSessionInfo returns null for non-existent session", async () => {
    // #when
    const info = await getSessionInfo("ses_nonexistent")

    // #then
    expect(info).toBeNull()
  })

  test("getSessionInfo aggregates session metadata correctly", async () => {
    // #given
    const sessionID = "ses_test123"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })

    const now = Date.now()
    writeFileSync(
      join(sessionPath, "msg_001.json"),
      JSON.stringify({
        id: "msg_001",
        role: "user",
        agent: "build",
        time: { created: now - 10000 },
      })
    )
    writeFileSync(
      join(sessionPath, "msg_002.json"),
      JSON.stringify({
        id: "msg_002",
        role: "assistant",
        agent: "oracle",
        time: { created: now },
      })
    )

    // #when
    const info = await getSessionInfo(sessionID)

    // #then
    expect(info).not.toBeNull()
    expect(info?.id).toBe(sessionID)
    expect(info?.message_count).toBe(2)
    expect(info?.agents_used).toContain("build")
    expect(info?.agents_used).toContain("oracle")
  })
})

describe("session-manager storage - getMainSessions", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_MESSAGE_STORAGE, { recursive: true })
    mkdirSync(TEST_PART_STORAGE, { recursive: true })
    mkdirSync(TEST_SESSION_STORAGE, { recursive: true })
    mkdirSync(TEST_TODO_DIR, { recursive: true })
    mkdirSync(TEST_TRANSCRIPT_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  function createSessionMetadata(
    projectID: string,
    sessionID: string,
    opts: { parentID?: string; directory: string; updated: number }
  ) {
    const projectDir = join(TEST_SESSION_STORAGE, projectID)
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(
      join(projectDir, `${sessionID}.json`),
      JSON.stringify({
        id: sessionID,
        projectID,
        directory: opts.directory,
        parentID: opts.parentID,
        time: { created: opts.updated - 1000, updated: opts.updated },
      })
    )
  }

  function createMessageForSession(sessionID: string, msgID: string, created: number) {
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })
    writeFileSync(
      join(sessionPath, `${msgID}.json`),
      JSON.stringify({ id: msgID, role: "user", time: { created } })
    )
  }

  test("getMainSessions returns only sessions without parentID", async () => {
    // #given
    const projectID = "proj_abc123"
    const now = Date.now()

    createSessionMetadata(projectID, "ses_main1", { directory: "/test/path", updated: now })
    createSessionMetadata(projectID, "ses_main2", { directory: "/test/path", updated: now - 1000 })
    createSessionMetadata(projectID, "ses_child1", { directory: "/test/path", updated: now, parentID: "ses_main1" })

    createMessageForSession("ses_main1", "msg_001", now)
    createMessageForSession("ses_main2", "msg_001", now - 1000)
    createMessageForSession("ses_child1", "msg_001", now)

    // #when
    const sessions = await storage.getMainSessions({ directory: "/test/path" })

    // #then
    expect(sessions.length).toBe(2)
    expect(sessions.map((s) => s.id)).not.toContain("ses_child1")
  })

  test("getMainSessions sorts by time.updated descending (most recent first)", async () => {
    // #given
    const projectID = "proj_abc123"
    const now = Date.now()

    createSessionMetadata(projectID, "ses_old", { directory: "/test/path", updated: now - 5000 })
    createSessionMetadata(projectID, "ses_mid", { directory: "/test/path", updated: now - 2000 })
    createSessionMetadata(projectID, "ses_new", { directory: "/test/path", updated: now })

    createMessageForSession("ses_old", "msg_001", now - 5000)
    createMessageForSession("ses_mid", "msg_001", now - 2000)
    createMessageForSession("ses_new", "msg_001", now)

    // #when
    const sessions = await storage.getMainSessions({ directory: "/test/path" })

    // #then
    expect(sessions.length).toBe(3)
    expect(sessions[0].id).toBe("ses_new")
    expect(sessions[1].id).toBe("ses_mid")
    expect(sessions[2].id).toBe("ses_old")
  })

  test("getMainSessions filters by directory (project path)", async () => {
    // #given
    const projectA = "proj_aaa"
    const projectB = "proj_bbb"
    const now = Date.now()

    createSessionMetadata(projectA, "ses_projA", { directory: "/path/to/projectA", updated: now })
    createSessionMetadata(projectB, "ses_projB", { directory: "/path/to/projectB", updated: now })

    createMessageForSession("ses_projA", "msg_001", now)
    createMessageForSession("ses_projB", "msg_001", now)

    // #when
    const sessionsA = await storage.getMainSessions({ directory: "/path/to/projectA" })
    const sessionsB = await storage.getMainSessions({ directory: "/path/to/projectB" })

    // #then
    expect(sessionsA.length).toBe(1)
    expect(sessionsA[0].id).toBe("ses_projA")
    expect(sessionsB.length).toBe(1)
    expect(sessionsB[0].id).toBe("ses_projB")
  })

  test("getMainSessions returns all main sessions when directory is not specified", async () => {
    // #given
    const projectA = "proj_aaa"
    const projectB = "proj_bbb"
    const now = Date.now()

    createSessionMetadata(projectA, "ses_projA", { directory: "/path/to/projectA", updated: now })
    createSessionMetadata(projectB, "ses_projB", { directory: "/path/to/projectB", updated: now - 1000 })

    createMessageForSession("ses_projA", "msg_001", now)
    createMessageForSession("ses_projB", "msg_001", now - 1000)

    // #when
    const sessions = await storage.getMainSessions({})

    // #then
    expect(sessions.length).toBe(2)
  })
})
