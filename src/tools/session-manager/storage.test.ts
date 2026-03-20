import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

const TEST_DIR = join(tmpdir(), `omo-test-session-manager-${randomUUID()}`)
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

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

mock.module("../../shared/opencode-storage-paths", () => ({
  OPENCODE_STORAGE: TEST_DIR,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: TEST_PART_STORAGE,
  SESSION_STORAGE: TEST_SESSION_STORAGE,
}))

mock.module("../../shared/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) => {
    if (!sessionID.startsWith("ses_")) return null
    if (/[/\\]|\.\./.test(sessionID)) return null
    if (!existsSync(TEST_MESSAGE_STORAGE)) return null

    const directPath = join(TEST_MESSAGE_STORAGE, sessionID)
    if (existsSync(directPath)) {
      return directPath
    }

    for (const dir of readdirSync(TEST_MESSAGE_STORAGE)) {
      const nestedPath = join(TEST_MESSAGE_STORAGE, dir, sessionID)
      if (existsSync(nestedPath)) {
        return nestedPath
      }
    }

    return null
  },
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
    // when
    const sessions = await getAllSessions()

    // then
    expect(Array.isArray(sessions)).toBe(true)
    expect(sessions).toEqual([])
  })

  test("getMessageDir finds session in direct path", () => {
    // given
    const sessionID = "ses_test123"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })
    writeFileSync(join(sessionPath, "msg_001.json"), JSON.stringify({ id: "msg_001", role: "user" }))

    // when
    const result = getMessageDir(sessionID)

    // then
    expect(result).toBe(sessionPath)
  })

  test("sessionExists returns false for non-existent session", async () => {
    // when
    const exists = await sessionExists("ses_nonexistent")

    // then
    expect(exists).toBe(false)
  })

  test("sessionExists returns true for existing session", async () => {
    // given
    const sessionID = "ses_exists"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })
    writeFileSync(join(sessionPath, "msg_001.json"), JSON.stringify({ id: "msg_001" }))

    // when
    const exists = await sessionExists(sessionID)

    // then
    expect(exists).toBe(true)
  })

  test("readSessionMessages returns empty array for non-existent session", async () => {
    // when
    const messages = await readSessionMessages("ses_nonexistent")

    // then
    expect(messages).toEqual([])
  })

  test("readSessionMessages sorts messages by timestamp", async () => {
    // given
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

    // when
    const messages = await readSessionMessages(sessionID)

    // then
    expect(messages.length).toBe(2)
    expect(messages[0].id).toBe("msg_001")
    expect(messages[1].id).toBe("msg_002")
  })

  test("readSessionTodos returns empty array when no todos exist", async () => {
    // when
    const todos = await readSessionTodos("ses_nonexistent")

    // then
    expect(todos).toEqual([])
  })

  test("getSessionInfo returns null for non-existent session", async () => {
    // when
    const info = await getSessionInfo("ses_nonexistent")

    // then
    expect(info).toBeNull()
  })

  test("getSessionInfo aggregates session metadata correctly", async () => {
    // given
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

    // when
    const info = await getSessionInfo(sessionID)

    // then
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
    // given
    const projectID = "proj_abc123"
    const now = Date.now()

    createSessionMetadata(projectID, "ses_main1", { directory: "/test/path", updated: now })
    createSessionMetadata(projectID, "ses_main2", { directory: "/test/path", updated: now - 1000 })
    createSessionMetadata(projectID, "ses_child1", { directory: "/test/path", updated: now, parentID: "ses_main1" })

    createMessageForSession("ses_main1", "msg_001", now)
    createMessageForSession("ses_main2", "msg_001", now - 1000)
    createMessageForSession("ses_child1", "msg_001", now)

    // when
    const sessions = await storage.getMainSessions({ directory: "/test/path" })

    // then
    expect(sessions.length).toBe(2)
    expect(sessions.map((s) => s.id)).not.toContain("ses_child1")
  })

  test("getMainSessions sorts by time.updated descending (most recent first)", async () => {
    // given
    const projectID = "proj_abc123"
    const now = Date.now()

    createSessionMetadata(projectID, "ses_old", { directory: "/test/path", updated: now - 5000 })
    createSessionMetadata(projectID, "ses_mid", { directory: "/test/path", updated: now - 2000 })
    createSessionMetadata(projectID, "ses_new", { directory: "/test/path", updated: now })

    createMessageForSession("ses_old", "msg_001", now - 5000)
    createMessageForSession("ses_mid", "msg_001", now - 2000)
    createMessageForSession("ses_new", "msg_001", now)

    // when
    const sessions = await storage.getMainSessions({ directory: "/test/path" })

    // then
    expect(sessions.length).toBe(3)
    expect(sessions[0].id).toBe("ses_new")
    expect(sessions[1].id).toBe("ses_mid")
    expect(sessions[2].id).toBe("ses_old")
  })

  test("getMainSessions filters by directory (project path)", async () => {
    // given
    const projectA = "proj_aaa"
    const projectB = "proj_bbb"
    const now = Date.now()

    createSessionMetadata(projectA, "ses_projA", { directory: "/path/to/projectA", updated: now })
    createSessionMetadata(projectB, "ses_projB", { directory: "/path/to/projectB", updated: now })

    createMessageForSession("ses_projA", "msg_001", now)
    createMessageForSession("ses_projB", "msg_001", now)

    // when
    const sessionsA = await storage.getMainSessions({ directory: "/path/to/projectA" })
    const sessionsB = await storage.getMainSessions({ directory: "/path/to/projectB" })

    // then
    expect(sessionsA.length).toBe(1)
    expect(sessionsA[0].id).toBe("ses_projA")
    expect(sessionsB.length).toBe(1)
    expect(sessionsB[0].id).toBe("ses_projB")
  })

  test("getMainSessions returns all main sessions when directory is not specified", async () => {
    // given
    const projectA = "proj_aaa"
    const projectB = "proj_bbb"
    const now = Date.now()

    createSessionMetadata(projectA, "ses_projA", { directory: "/path/to/projectA", updated: now })
    createSessionMetadata(projectB, "ses_projB", { directory: "/path/to/projectB", updated: now - 1000 })

    createMessageForSession("ses_projA", "msg_001", now)
    createMessageForSession("ses_projB", "msg_001", now - 1000)

    // when
    const sessions = await storage.getMainSessions({})

    // then
    expect(sessions.length).toBe(2)
  })
})

describe("session-manager storage - SDK path (beta mode)", () => {
  const mockClient = {
    session: {
      list: mock(() => Promise.resolve({ data: [] })),
      messages: mock(() => Promise.resolve({ data: [] })),
      todo: mock(() => Promise.resolve({ data: [] })),
    },
  }

  beforeEach(() => {
    // Reset mocks
    mockClient.session.list.mockClear()
    mockClient.session.messages.mockClear()
    mockClient.session.todo.mockClear()
  })

  test("getMainSessions uses SDK when beta mode is enabled", async () => {
    // given
    const mockSessions = [
      { id: "ses_1", directory: "/test", parentID: null, time: { created: 1000, updated: 2000 } },
      { id: "ses_2", directory: "/test", parentID: "ses_1", time: { created: 1000, updated: 1500 } },
    ]
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: mockSessions }))

    // Mock isSqliteBackend to return true
    mock.module("../../shared/opencode-storage-detection", () => ({
      isSqliteBackend: () => true,
      resetSqliteBackendCache: () => {},
    }))

    // Re-import to get fresh module with mocked isSqliteBackend
    const { setStorageClient, getMainSessions } = await import("./storage")
    setStorageClient(mockClient as unknown as Parameters<typeof setStorageClient>[0])

    // when
    const sessions = await getMainSessions({ directory: "/test" })

    // then
    expect(mockClient.session.list).toHaveBeenCalled()
    expect(sessions.length).toBe(1)
    expect(sessions[0].id).toBe("ses_1")
  })

  test("getAllSessions uses SDK when beta mode is enabled", async () => {
    // given
    const mockSessions = [
      { id: "ses_1", directory: "/test", time: { created: 1000, updated: 2000 } },
      { id: "ses_2", directory: "/test", time: { created: 1000, updated: 1500 } },
    ]
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: mockSessions }))

    mock.module("../../shared/opencode-storage-detection", () => ({
      isSqliteBackend: () => true,
      resetSqliteBackendCache: () => {},
    }))

    const { setStorageClient, getAllSessions } = await import("./storage")
    setStorageClient(mockClient as unknown as Parameters<typeof setStorageClient>[0])

    // when
    const sessionIDs = await getAllSessions()

    // then
    expect(mockClient.session.list).toHaveBeenCalled()
    expect(sessionIDs).toEqual(["ses_1", "ses_2"])
  })

  test("readSessionMessages uses SDK when beta mode is enabled", async () => {
    // given
    const mockMessages = [
      {
        info: { id: "msg_1", role: "user", agent: "test", time: { created: 1000 } },
        parts: [{ id: "part_1", type: "text", text: "Hello" }],
      },
      {
        info: { id: "msg_2", role: "assistant", agent: "oracle", time: { created: 2000 } },
        parts: [{ id: "part_2", type: "text", text: "Hi there" }],
      },
    ]
    mockClient.session.messages.mockImplementation(() => Promise.resolve({ data: mockMessages }))

    mock.module("../../shared/opencode-storage-detection", () => ({
      isSqliteBackend: () => true,
      resetSqliteBackendCache: () => {},
    }))

    const { setStorageClient, readSessionMessages } = await import("./storage")
    setStorageClient(mockClient as unknown as Parameters<typeof setStorageClient>[0])

    // when
    const messages = await readSessionMessages("ses_test")

    // then
    expect(mockClient.session.messages).toHaveBeenCalledWith({ path: { id: "ses_test" } })
    expect(messages.length).toBe(2)
    expect(messages[0].id).toBe("msg_1")
    expect(messages[1].id).toBe("msg_2")
    expect(messages[0].role).toBe("user")
    expect(messages[1].role).toBe("assistant")
  })

  test("readSessionTodos uses SDK when beta mode is enabled", async () => {
    // given
    const mockTodos = [
      { id: "todo_1", content: "Task 1", status: "pending", priority: "high" },
      { id: "todo_2", content: "Task 2", status: "completed", priority: "medium" },
    ]
    mockClient.session.todo.mockImplementation(() => Promise.resolve({ data: mockTodos }))

    mock.module("../../shared/opencode-storage-detection", () => ({
      isSqliteBackend: () => true,
      resetSqliteBackendCache: () => {},
    }))

    const { setStorageClient, readSessionTodos } = await import("./storage")
    setStorageClient(mockClient as unknown as Parameters<typeof setStorageClient>[0])

    // when
    const todos = await readSessionTodos("ses_test")

    // then
    expect(mockClient.session.todo).toHaveBeenCalledWith({ path: { id: "ses_test" } })
    expect(todos.length).toBe(2)
    expect(todos[0].content).toBe("Task 1")
    expect(todos[1].content).toBe("Task 2")
    expect(todos[0].status).toBe("pending")
    expect(todos[1].status).toBe("completed")
  })

  test("SDK path returns empty array on error", async () => {
    // given
    mockClient.session.messages.mockImplementation(() => Promise.reject(new Error("API error")))

    mock.module("../../shared/opencode-storage-detection", () => ({
      isSqliteBackend: () => true,
      resetSqliteBackendCache: () => {},
    }))

    const { setStorageClient, readSessionMessages } = await import("./storage")
    setStorageClient(mockClient as unknown as Parameters<typeof setStorageClient>[0])

    // when
    const messages = await readSessionMessages("ses_test")

    // then
    expect(messages).toEqual([])
  })

  test("SDK path returns empty array when client is not set", async () => {
    //#given beta mode enabled but no client set
    mock.module("../../shared/opencode-storage-detection", () => ({
      isSqliteBackend: () => true,
      resetSqliteBackendCache: () => {},
    }))

    //#when client is explicitly cleared and messages are requested
    const { resetStorageClient, readSessionMessages } = await import("./storage")
    resetStorageClient()
    const messages = await readSessionMessages("ses_test")

    //#then should return empty array since no client and no JSON fallback
    expect(messages).toEqual([])
  })
})
