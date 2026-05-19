import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

const TEST_DIR = join(tmpdir(), `omo-test-session-manager-fallback-${randomUUID()}`)
const TEST_MESSAGE_STORAGE = join(TEST_DIR, "message")
const TEST_PART_STORAGE = join(TEST_DIR, "part")
const TEST_SESSION_STORAGE = join(TEST_DIR, "session")
const TEST_TODO_DIR = join(TEST_DIR, "todos")
const TEST_TRANSCRIPT_DIR = join(TEST_DIR, "transcripts")

let sqliteBackend = false

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
  isSqliteBackend: () => sqliteBackend,
  resetSqliteBackendCache: () => {},
}))

mock.module("../../shared/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) => {
    if (!sessionID.startsWith("ses_")) return null
    if (/[/\\]|\.\./.test(sessionID)) return null
    if (!existsSync(TEST_MESSAGE_STORAGE)) return null

    const directPath = join(TEST_MESSAGE_STORAGE, sessionID)
    if (existsSync(directPath)) return directPath

    for (const dir of readdirSync(TEST_MESSAGE_STORAGE)) {
      const nestedPath = join(TEST_MESSAGE_STORAGE, dir, sessionID)
      if (existsSync(nestedPath)) return nestedPath
    }

    return null
  },
}))

afterAll(() => {
  mock.restore()
})

const storage = await import("./storage")

function createSdkUnavailableError(message: string): Error {
  return new Error(message)
}

function createSessionMetadata(projectID: string, sessionID: string, directory: string, updated: number): void {
  const projectDir = join(TEST_SESSION_STORAGE, projectID)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(
    join(projectDir, `${sessionID}.json`),
    JSON.stringify({
      id: sessionID,
      projectID,
      directory,
      time: { created: updated - 1_000, updated },
    }),
  )
}

function createSessionMessage(sessionID: string, messageID: string, created: number, role = "user"): void {
  const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
  mkdirSync(sessionPath, { recursive: true })
  writeFileSync(
    join(sessionPath, `${messageID}.json`),
    JSON.stringify({ id: messageID, role, time: { created } }),
  )
}

function createSessionTodo(sessionID: string, items: Array<Record<string, unknown>>): void {
  mkdirSync(TEST_TODO_DIR, { recursive: true })
  writeFileSync(join(TEST_TODO_DIR, `${sessionID}.json`), JSON.stringify(items))
}

describe("session-manager storage fallback", () => {
  const mockClient = {
    session: {
      list: mock((): Promise<unknown> => Promise.resolve({ data: [] })),
      messages: mock((): Promise<unknown> => Promise.resolve({ data: [] })),
      todo: mock((): Promise<unknown> => Promise.resolve({ data: [] })),
    },
  }

  beforeEach(() => {
    sqliteBackend = true
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_MESSAGE_STORAGE, { recursive: true })
    mkdirSync(TEST_PART_STORAGE, { recursive: true })
    mkdirSync(TEST_SESSION_STORAGE, { recursive: true })
    mkdirSync(TEST_TODO_DIR, { recursive: true })
    mkdirSync(TEST_TRANSCRIPT_DIR, { recursive: true })
    mockClient.session.list.mockReset()
    mockClient.session.messages.mockReset()
    mockClient.session.todo.mockReset()
    storage.setStorageClient(mockClient as never)
  })

  afterEach(() => {
    storage.resetStorageClient()
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test("#given unreachable SDK list response #when getMainSessions runs #then falls back to file sessions", async () => {
    createSessionMetadata("proj_test", "ses_file", "/workspace/project", 2_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({ error: createSdkUnavailableError("fetch failed ECONNREFUSED") }))

    const sessions = await storage.getMainSessions({ directory: "/workspace/project" })

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe("ses_file")
  })

  test("#given empty SDK list response #when getMainSessions runs #then returns file-backed pre-migration sessions", async () => {
    createSessionMetadata("proj_test", "ses_file", "/workspace/project", 2_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: [] }))

    const sessions = await storage.getMainSessions({ directory: "/workspace/project" })

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe("ses_file")
  })

  test("#given SDK and file sessions overlap #when getMainSessions runs #then dedupes by id and keeps SDK metadata", async () => {
    createSessionMetadata("proj_test", "ses_file", "/workspace/project", 2_000)
    createSessionMetadata("proj_test", "ses_sdk", "/workspace/project", 1_500)
    mockClient.session.list.mockImplementation(() => Promise.resolve({
      data: [
        {
          id: "ses_sdk",
          projectID: "sdk_project",
          directory: "/workspace/project",
          time: { created: 3_000, updated: 4_000 },
        },
      ],
    }))

    const sessions = await storage.getMainSessions({ directory: "/workspace/project" })

    expect(sessions).toHaveLength(2)
    expect(sessions.map((session) => session.id)).toEqual(["ses_sdk", "ses_file"])
    expect(sessions[0].projectID).toBe("sdk_project")
  })

  test("#given empty SDK session list #when getAllSessions runs #then returns file-backed session ids", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: [] }))

    const sessionIds = await storage.getAllSessions()

    expect(sessionIds).toEqual(["ses_file"])
  })

  test("#given SDK and file session ids overlap #when getAllSessions runs #then returns deduped union", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    createSessionMessage("ses_sdk", "msg_002", 2_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({
      data: [
        { id: "ses_sdk" },
      ],
    }))

    const sessionIds = await storage.getAllSessions()

    expect(sessionIds).toEqual(["ses_sdk", "ses_file"])
  })

  test("#given unreachable SDK messages error #when readSessionMessages runs #then falls back to file messages", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.messages.mockImplementation(() => Promise.reject(createSdkUnavailableError("Unable to connect to http://localhost:4096")))

    const messages = await storage.readSessionMessages("ses_file")

    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe("msg_001")
  })

  test("#given empty SDK messages response #when readSessionMessages runs #then falls back to file messages", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.messages.mockImplementation(() => Promise.resolve({ data: [] }))

    const messages = await storage.readSessionMessages("ses_file")

    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe("msg_001")
  })

  test("#given unreachable SDK todo response #when readSessionTodos runs #then falls back to file todos", async () => {
    createSessionTodo("ses_file", [{ id: "todo_1", content: "Fallback todo", status: "pending" }])
    mockClient.session.todo.mockImplementation(() => Promise.resolve({ error: createSdkUnavailableError("network error: server unreachable") }))

    const todos = await storage.readSessionTodos("ses_file")

    expect(todos).toHaveLength(1)
    expect(todos[0].content).toBe("Fallback todo")
  })

  test("#given empty SDK todo response #when readSessionTodos runs #then falls back to file todos", async () => {
    createSessionTodo("ses_file", [{ id: "todo_1", content: "Fallback todo", status: "pending" }])
    mockClient.session.todo.mockImplementation(() => Promise.resolve({ data: [] }))

    const todos = await storage.readSessionTodos("ses_file")

    expect(todos).toHaveLength(1)
    expect(todos[0].content).toBe("Fallback todo")
  })

  test("#given unreachable SDK list error #when sessionExists runs #then falls back to file existence", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.list.mockImplementation(() => Promise.reject(createSdkUnavailableError("ETIMEDOUT while connecting")))

    const exists = await storage.sessionExists("ses_file")

    expect(exists).toBe(true)
  })

  test("#given empty SDK session list #when sessionExists runs #then falls back to file existence", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: [] }))

    const exists = await storage.sessionExists("ses_file")

    expect(exists).toBe(true)
  })

  test("#given semantic SDK error #when readSessionMessages runs #then rethrows instead of hiding bug", async () => {
    mockClient.session.messages.mockImplementation(() => Promise.resolve({ error: new Error("session not found") }))

    await expect(storage.readSessionMessages("ses_missing")).rejects.toThrow("session not found")
  })
})
