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

describe("session-manager storage - findSessionMetadataPath", () => {
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

  function createSessionMetadata(projectID: string, sessionID: string, title?: string) {
    const projectDir = join(TEST_SESSION_STORAGE, projectID)
    mkdirSync(projectDir, { recursive: true })
    const metadata = {
      id: sessionID,
      directory: `/test/path/${projectID}`,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
      title: title || undefined,
    }
    writeFileSync(join(projectDir, `${sessionID}.json`), JSON.stringify(metadata, null, 2))
  }

  test("returns empty string for non-existent session", () => {
    // #given non-existent session ID
    const sessionID = "ses_doesnotexist_12345"

    // #when searching for metadata path
    const path = storage.findSessionMetadataPath(sessionID)

    // #then returns empty string
    expect(path).toBe("")
  })

  test("returns correct path when session exists in nested directory", () => {
    // #given existing session in nested directory structure
    const projectID = "test-project-123"
    const sessionID = "ses_test_456"
    createSessionMetadata(projectID, sessionID)

    // #when searching for metadata path
    const path = storage.findSessionMetadataPath(sessionID)

    // #then returns full path to session JSON file
    const expectedPath = join(TEST_SESSION_STORAGE, projectID, `${sessionID}.json`)
    expect(path).toBe(expectedPath)
    expect(existsSync(path)).toBe(true)
  })

  test("handles multiple projects and finds correct session", () => {
    // #given sessions in multiple project directories
    const projectA = "project-a"
    const projectB = "project-b"
    const sessionA = "ses_a_123"
    const sessionB = "ses_b_456"

    createSessionMetadata(projectA, sessionA)
    createSessionMetadata(projectB, sessionB)

    // #when searching for specific session
    const pathA = storage.findSessionMetadataPath(sessionA)
    const pathB = storage.findSessionMetadataPath(sessionB)

    // #then returns correct paths for each session
    expect(pathA).toBe(join(TEST_SESSION_STORAGE, projectA, `${sessionA}.json`))
    expect(pathB).toBe(join(TEST_SESSION_STORAGE, projectB, `${sessionB}.json`))
  })

  test("returns empty string when SESSION_STORAGE does not exist", () => {
    // #given SESSION_STORAGE directory removed
    rmSync(TEST_SESSION_STORAGE, { recursive: true, force: true })
    const nonExistentSession = "ses_any_789"

    // #when searching in non-existent storage
    const path = storage.findSessionMetadataPath(nonExistentSession)

    // #then returns empty string gracefully
    expect(path).toBe("")
  })
})

describe("session-manager storage - renameSession", () => {
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

  function createSessionMetadata(projectID: string, sessionID: string, title?: string) {
    const projectDir = join(TEST_SESSION_STORAGE, projectID)
    mkdirSync(projectDir, { recursive: true })
    const metadata = {
      id: sessionID,
      directory: `/test/path/${projectID}`,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
      title: title || undefined,
    }
    writeFileSync(join(projectDir, `${sessionID}.json`), JSON.stringify(metadata, null, 2))
  }

  test("returns false for non-existent session", async () => {
    // #given non-existent session ID
    const sessionID = "ses_doesnotexist_12345"

    // #when attempting to rename
    const result = await storage.renameSession(sessionID, "New Title")

    // #then returns false
    expect(result).toBe(false)
  })

  test("successfully renames existing session and updates title", async () => {
    // #given existing session with initial title
    const projectID = "test-project-123"
    const sessionID = "ses_test_456"
    const initialTitle = "Initial Title"
    createSessionMetadata(projectID, sessionID, initialTitle)

    // #when renaming session
    const newTitle = "Updated Title"
    const result = await storage.renameSession(sessionID, newTitle)

    // #then returns true and updates title in metadata
    expect(result).toBe(true)

    const sessionPath = join(TEST_SESSION_STORAGE, projectID, `${sessionID}.json`)
    const content = await Bun.file(sessionPath).text()
    const metadata = JSON.parse(content)
    expect(metadata.title).toBe(newTitle)
  })

  test("updates time.updated timestamp when renaming", async () => {
    // #given existing session
    const projectID = "test-project-123"
    const sessionID = "ses_test_456"
    createSessionMetadata(projectID, sessionID, "Original Title")

    const sessionPath = join(TEST_SESSION_STORAGE, projectID, `${sessionID}.json`)
    const beforeContent = await Bun.file(sessionPath).text()
    const beforeMetadata = JSON.parse(beforeContent)
    const originalUpdated = beforeMetadata.time.updated

    // Wait to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 10))

    // #when renaming session
    const result = await storage.renameSession(sessionID, "New Title")

    // #then time.updated is greater than original
    expect(result).toBe(true)

    const afterContent = await Bun.file(sessionPath).text()
    const afterMetadata = JSON.parse(afterContent)
    expect(afterMetadata.time.updated).toBeGreaterThan(originalUpdated)
  })

  test("handles empty string title by clearing title field", async () => {
    // #given existing session with title
    const projectID = "test-project-123"
    const sessionID = "ses_test_456"
    createSessionMetadata(projectID, sessionID, "Some Title")

    // #when renaming with empty string
    const result = await storage.renameSession(sessionID, "")

    // #then title is cleared (undefined or empty)
    expect(result).toBe(true)

    const sessionPath = join(TEST_SESSION_STORAGE, projectID, `${sessionID}.json`)
    const content = await Bun.file(sessionPath).text()
    const metadata = JSON.parse(content)
    expect(metadata.title === undefined || metadata.title === "").toBe(true)
  })

  test("preserves other metadata fields when renaming", async () => {
    // #given existing session with metadata
    const projectID = "test-project-123"
    const sessionID = "ses_test_456"
    createSessionMetadata(projectID, sessionID, "Original")

    const sessionPath = join(TEST_SESSION_STORAGE, projectID, `${sessionID}.json`)
    const beforeContent = await Bun.file(sessionPath).text()
    const beforeMetadata = JSON.parse(beforeContent)

    // #when renaming session
    await storage.renameSession(sessionID, "New Title")

    // #then other fields remain unchanged
    const afterContent = await Bun.file(sessionPath).text()
    const afterMetadata = JSON.parse(afterContent)

    expect(afterMetadata.id).toBe(beforeMetadata.id)
    expect(afterMetadata.directory).toBe(beforeMetadata.directory)
    expect(afterMetadata.time.created).toBe(beforeMetadata.time.created)
  })

  test("handles invalid JSON gracefully", async () => {
    // #given session file with invalid JSON
    const projectID = "test-project-123"
    const sessionID = "ses_test_456"
    const projectDir = join(TEST_SESSION_STORAGE, projectID)
    mkdirSync(projectDir, { recursive: true })
    const sessionPath = join(projectDir, `${sessionID}.json`)
    writeFileSync(sessionPath, "{ invalid json }")

    // #when attempting to rename
    const result = await storage.renameSession(sessionID, "New Title")

    // #then returns false due to parse error
    expect(result).toBe(false)
  })

  test("handles file system errors gracefully", async () => {
    // #given existing session
    const projectID = "test-project-123"
    const sessionID = "ses_test_456"
    createSessionMetadata(projectID, sessionID, "Title")

    // #when attempting to rename (should handle any errors gracefully)
    const result = await storage.renameSession(sessionID, "New Title")

    // #then should return boolean (either true or false, not throw)
    expect(typeof result).toBe("boolean")
  })
})
