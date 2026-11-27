import { describe, test, expect, beforeEach, afterEach, afterAll, mock, spyOn } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { preserveModuleMocksForTestFile } from "../../testing/module-mock-lifecycle"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import * as storageDetection from "../../shared/opencode-storage-detection"

// Named, not a namespace spread: a spread counts every export as used and hides dead ones from knip.
// satisfies flags a missing or extra key in the editor; no gate typechecks test files, so the export-list test below is
// the enforced check that the restore set matches the module.
const {
  MESSAGE_STORAGE,
  PART_STORAGE,
  SESSION_STORAGE,
  TODO_DIR,
  TRANSCRIPT_DIR,
  SESSION_LIST_DESCRIPTION,
  SESSION_READ_DESCRIPTION,
  SESSION_SEARCH_DESCRIPTION,
  SESSION_INFO_DESCRIPTION,
} = await import("./constants")
const realConstants = {
  MESSAGE_STORAGE,
  PART_STORAGE,
  SESSION_STORAGE,
  TODO_DIR,
  TRANSCRIPT_DIR,
  SESSION_LIST_DESCRIPTION,
  SESSION_READ_DESCRIPTION,
  SESSION_SEARCH_DESCRIPTION,
  SESSION_INFO_DESCRIPTION,
} satisfies Record<keyof typeof import("./constants"), unknown>

const TEST_DIR = join(tmpdir(), `omo-test-session-manager-${randomUUID()}`)
const TEST_TODO_DIR = join(TEST_DIR, "todos")
const TEST_TRANSCRIPT_DIR = join(TEST_DIR, "transcripts")
const fixtureDirs = new Set<string>()

mock.module("./constants", () => ({
  TODO_DIR: TEST_TODO_DIR,
  TRANSCRIPT_DIR: TEST_TRANSCRIPT_DIR,
}))
preserveModuleMocksForTestFile(import.meta.url)

function makeFixtureDir(root: string, id: string): string {
  const directory = join(root, id)
  fixtureDirs.add(directory)
  mkdirSync(directory, { recursive: true })
  return directory
}

test("#given the real ./constants snapshot #then it names every export the module declares", async () => {
  // Bun's parser lists the names constants.ts exports, its own declarations and its `export { ... } from` names. Reading
  // them is not a use for knip, but passing this check is: every name must also be destructured into the restore set
  // above, so a dead export added later stops being reported by knip once it is named there. When this fails on a new
  // export, confirm production reads it before adding it to the restore set.
  const source = await Bun.file(join(import.meta.dir, "constants.ts")).text()
  const declared = new Bun.Transpiler({ loader: "ts" }).scan(source).exports
  expect(Object.keys(realConstants).sort()).toEqual([...declared].sort())
})

afterAll(async () => {
  mock.restore()
  // Boundary: later test files import these modules fresh, and the compaction-marker fixture writes under
  // PART_STORAGE. None of them may still name this file's fixture.
  const storagePaths = await import("../../shared/opencode-storage-paths")
  const shared = await import("../../shared")
  const constants = await import("./constants")
  const { getCompactionPartStorageDir } = await import("../../shared/compaction-marker")
  const exposed = [
    ...["OPENCODE_STORAGE", "MESSAGE_STORAGE", "PART_STORAGE", "SESSION_STORAGE"].flatMap((name) => [
      `opencode-storage-paths.${name}=${String(Reflect.get(storagePaths, name))}`,
      `shared.${name}=${String(Reflect.get(shared, name))}`,
    ]),
    `constants.MESSAGE_STORAGE=${constants.MESSAGE_STORAGE}`,
    `constants.PART_STORAGE=${constants.PART_STORAGE}`,
    `constants.SESSION_STORAGE=${constants.SESSION_STORAGE}`,
    `constants.TODO_DIR=${constants.TODO_DIR}`,
    `constants.TRANSCRIPT_DIR=${constants.TRANSCRIPT_DIR}`,
    `compaction-marker.part=${getCompactionPartStorageDir("msg_boundary")}`,
  ]
  expect(exposed.filter((entry) => entry.includes(TEST_DIR))).toEqual([])
  // #13502: TEST_DIR is the mocked storage root; remove it after the file's last test whatever block ran last.
  storage.resetStorageClient()
  rmSync(TEST_DIR, { recursive: true, force: true })
})

const { getAllSessions, getMessageDir, sessionExists, readSessionMessages, readSessionTodos, getSessionInfo } =
  await import("./storage")

const storage = await import("./storage")

afterEach(() => {
  storage.resetStorageClient()
  for (const directory of fixtureDirs) {
    rmSync(directory, { recursive: true, force: true })
  }
  fixtureDirs.clear()
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe("session-manager storage", () => {
  let sqliteBackend = false
  let restoreStorageDetection: () => void

  beforeEach(() => {
    sqliteBackend = false
    const sqlite = spyOn(storageDetection, "isSqliteBackend").mockImplementation(() => sqliteBackend)
    restoreStorageDetection = () => sqlite.mockRestore()
    mkdirSync(TEST_TODO_DIR, { recursive: true })
  })

  afterEach(() => {
    restoreStorageDetection()
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
    const sessionPath = makeFixtureDir(MESSAGE_STORAGE, sessionID)
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
    const sessionPath = makeFixtureDir(MESSAGE_STORAGE, sessionID)
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
    const sessionPath = makeFixtureDir(MESSAGE_STORAGE, sessionID)

    writeFileSync(
      join(sessionPath, "msg_002.json"),
      JSON.stringify({ id: "msg_002", role: "assistant", time: { created: 2000 } }),
    )
    writeFileSync(
      join(sessionPath, "msg_001.json"),
      JSON.stringify({ id: "msg_001", role: "user", time: { created: 1000 } }),
    )

    // when
    const messages = await readSessionMessages(sessionID)

    // then
    expect(messages.length).toBe(2)
    expect(messages[0].id).toBe("msg_001")
    expect(messages[1].id).toBe("msg_002")
  })

  test("readSessionMessages skips malformed message and part files", async () => {
    // given
    const sessionID = "ses_malformed_messages"
    const sessionPath = makeFixtureDir(MESSAGE_STORAGE, sessionID)
    const partPath = makeFixtureDir(PART_STORAGE, "msg_valid")

    writeFileSync(join(sessionPath, "msg_bad.json"), "{")
    writeFileSync(
      join(sessionPath, "msg_valid.json"),
      JSON.stringify({ id: "msg_valid", role: "user", time: { created: 1000 } }),
    )
    writeFileSync(join(partPath, "part_bad.json"), "{")
    writeFileSync(join(partPath, "part_valid.json"), JSON.stringify({ id: "part_valid", type: "text", text: "hello" }))

    // when
    const messages = await readSessionMessages(sessionID)

    // then
    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe("msg_valid")
    expect(messages[0].parts).toEqual([{ id: "part_valid", type: "text", text: "hello" }])
  })

  test("readSessionTodos returns empty array when no todos exist", async () => {
    // when
    const todos = await readSessionTodos("ses_nonexistent")

    // then
    expect(todos).toEqual([])
  })

  test("readSessionTodos only reads the exact session todo file", async () => {
    // given
    writeFileSync(
      join(TEST_TODO_DIR, "ses_1.json"),
      JSON.stringify([{ id: "todo_exact", content: "Exact match", status: "pending" }]),
    )
    writeFileSync(
      join(TEST_TODO_DIR, "ses_10.json"),
      JSON.stringify([{ id: "todo_collision", content: "Wrong session", status: "completed" }]),
    )

    // when
    const todos = await readSessionTodos("ses_1")

    // then
    expect(todos).toHaveLength(1)
    expect(todos[0].id).toBe("todo_exact")
    expect(todos[0].content).toBe("Exact match")
  })

  test("readSessionTodos returns empty array for malformed todo file", async () => {
    // given
    writeFileSync(join(TEST_TODO_DIR, "ses_bad.json"), "{")

    // when
    const todos = await readSessionTodos("ses_bad")

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
    const sessionPath = makeFixtureDir(MESSAGE_STORAGE, sessionID)

    const now = Date.now()
    writeFileSync(
      join(sessionPath, "msg_001.json"),
      JSON.stringify({
        id: "msg_001",
        role: "user",
        agent: "build",
        time: { created: now - 10000 },
      }),
    )
    writeFileSync(
      join(sessionPath, "msg_002.json"),
      JSON.stringify({
        id: "msg_002",
        role: "assistant",
        agent: "oracle",
        time: { created: now },
      }),
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

  test("getSessionInfo uses SDK session messages on sqlite backend", async () => {
    sqliteBackend = true
    const now = Date.now()

    storage.setStorageClient({
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                id: "msg_sqlite_1",
                role: "user",
                agent: "atlas",
                time: { created: now - 5000, updated: now - 5000 },
              },
              parts: [],
            },
            {
              info: {
                id: "msg_sqlite_2",
                role: "assistant",
                agent: "prometheus",
                time: { created: now, updated: now },
              },
              parts: [],
            },
          ],
        }),
        todo: async () => ({ data: [] }),
      },
    } as never)

    const info = await getSessionInfo("ses_sqlite")

    expect(info).not.toBeNull()
    expect(info?.id).toBe("ses_sqlite")
    expect(info?.message_count).toBe(2)
    expect(info?.agents_used).toContain("atlas")
    expect(info?.agents_used).toContain("prometheus")
  })
})

describe("session-manager storage - getMainSessions", () => {
  function createSessionMetadata(
    projectID: string,
    sessionID: string,
    opts: { parentID?: string; directory: string; updated: number },
  ) {
    const projectDir = makeFixtureDir(SESSION_STORAGE, projectID)
    writeFileSync(
      join(projectDir, `${sessionID}.json`),
      JSON.stringify({
        id: sessionID,
        projectID,
        directory: opts.directory,
        parentID: opts.parentID,
        time: { created: opts.updated - 1000, updated: opts.updated },
      }),
    )
  }

  function createMessageForSession(sessionID: string, msgID: string, created: number) {
    const sessionPath = makeFixtureDir(MESSAGE_STORAGE, sessionID)
    writeFileSync(join(sessionPath, `${msgID}.json`), JSON.stringify({ id: msgID, role: "user", time: { created } }))
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

  test("getMainSessions matches directory when filter has trailing slash (file storage)", async () => {
    // given
    const projectA = "proj_trail"
    const now = Date.now()

    createSessionMetadata(projectA, "ses_trail", { directory: "/path/to/projectA", updated: now })
    createMessageForSession("ses_trail", "msg_001", now)

    // when
    const sessions = await storage.getMainSessions({ directory: "/path/to/projectA/" })

    // then
    expect(sessions.length).toBe(1)
    expect(sessions[0].id).toBe("ses_trail")
  })

  test("getMainSessions does not match distinct directories that share a prefix (file storage)", async () => {
    // given
    const projectA = "proj_prefix_a"
    const projectB = "proj_prefix_ab"
    const now = Date.now()

    createSessionMetadata(projectA, "ses_a", { directory: "/path/to/projectA", updated: now })
    createSessionMetadata(projectB, "ses_ab", { directory: "/path/to/projectAB", updated: now })
    createMessageForSession("ses_a", "msg_001", now)
    createMessageForSession("ses_ab", "msg_001", now)

    // when
    const sessions = await storage.getMainSessions({ directory: "/path/to/projectA" })

    // then
    expect(sessions.map((s) => s.id)).toEqual(["ses_a"])
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

  test("getMainSessions skips malformed metadata files", async () => {
    // given
    const projectID = "proj_malformed"
    const now = Date.now()
    const projectDir = makeFixtureDir(SESSION_STORAGE, projectID)
    writeFileSync(join(projectDir, "ses_bad.json"), "{")
    createSessionMetadata(projectID, "ses_valid", { directory: "/test/path", updated: now })

    // when
    const sessions = await storage.getMainSessions({ directory: "/test/path" })

    // then
    expect(sessions.map((session) => session.id)).toEqual(["ses_valid"])
  })

  test("getMainSessions returns all main sessions when directory is the server root sentinel", async () => {
    // given
    const projectA = "proj_aaa"
    const projectB = "proj_bbb"
    const now = Date.now()

    createSessionMetadata(projectA, "ses_projA", { directory: "/path/to/projectA", updated: now })
    createSessionMetadata(projectB, "ses_projB", { directory: "/path/to/projectB", updated: now - 1000 })

    createMessageForSession("ses_projA", "msg_001", now)
    createMessageForSession("ses_projB", "msg_001", now - 1000)

    // when
    const sessions = await storage.getMainSessions({ directory: "/" })

    // then
    expect(sessions.length).toBe(2)
    expect(sessions.map((s) => s.id).sort()).toEqual(["ses_projA", "ses_projB"])
  })
})

describe("session-manager storage - SDK path (beta mode)", () => {
  let restoreStorageDetection: () => void
  const mockClient = {
    session: {
      list: mock((): Promise<unknown> => Promise.resolve({ data: [] })),
      messages: mock((): Promise<unknown> => Promise.resolve({ data: [] })),
      todo: mock((): Promise<unknown> => Promise.resolve({ data: [] })),
    },
  }

  beforeEach(() => {
    const sqlite = spyOn(storageDetection, "isSqliteBackend").mockReturnValue(true)
    restoreStorageDetection = () => sqlite.mockRestore()
    // Reset mocks
    mockClient.session.list.mockClear()
    mockClient.session.messages.mockClear()
    mockClient.session.todo.mockClear()
  })

  afterEach(() => {
    restoreStorageDetection()
  })

  test("getMainSessions uses SDK when beta mode is enabled", async () => {
    // given
    const mockSessions = [
      { id: "ses_1", directory: "/test", parentID: null, time: { created: 1000, updated: 2000 } },
      { id: "ses_2", directory: "/test", parentID: "ses_1", time: { created: 1000, updated: 1500 } },
    ]
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: mockSessions }))

    const { setStorageClient, getMainSessions } = await import("./storage")
    setStorageClient(unsafeTestValue<Parameters<typeof setStorageClient>[0]>(mockClient))

    // when
    const sessions = await getMainSessions({ directory: "/test" })

    // then
    expect(mockClient.session.list).toHaveBeenCalled()
    expect(sessions.length).toBe(1)
    expect(sessions[0].id).toBe("ses_1")
  })

  test("getMainSessions matches SDK directory when filter has trailing slash", async () => {
    // given
    const mockSessions = [
      { id: "ses_trail_sdk", directory: "/path/to/projectA", parentID: null, time: { created: 1000, updated: 2000 } },
    ]
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: mockSessions }))

    const { setStorageClient, getMainSessions } = await import("./storage")
    setStorageClient(unsafeTestValue<Parameters<typeof setStorageClient>[0]>(mockClient))

    // when
    const sessions = await getMainSessions({ directory: "/path/to/projectA/" })

    // then
    expect(sessions.length).toBe(1)
    expect(sessions[0].id).toBe("ses_trail_sdk")
  })

  test("getAllSessions uses SDK when beta mode is enabled", async () => {
    // given
    const mockSessions = [
      { id: "ses_1", directory: "/test", time: { created: 1000, updated: 2000 } },
      { id: "ses_2", directory: "/test", time: { created: 1000, updated: 1500 } },
    ]
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: mockSessions }))

    const { setStorageClient, getAllSessions } = await import("./storage")
    setStorageClient(unsafeTestValue<Parameters<typeof setStorageClient>[0]>(mockClient))

    // when
    const sessionIDs = await getAllSessions()

    // then
    expect(mockClient.session.list).toHaveBeenCalled()
    expect(sessionIDs).toEqual(["ses_1", "ses_2"])
  })

  test("getAllSessions sorts SDK sessions by time.updated descending", async () => {
    // given
    const mockSessions = [
      { id: "ses_old", directory: "/test", time: { created: 1000, updated: 1000 } },
      { id: "ses_new", directory: "/test", time: { created: 2000, updated: 3000 } },
      { id: "ses_mid", directory: "/test", time: { created: 1500, updated: 2000 } },
    ]
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: mockSessions }))

    const { setStorageClient, getAllSessions } = await import("./storage")
    setStorageClient(unsafeTestValue<Parameters<typeof setStorageClient>[0]>(mockClient))

    // when
    const sessionIDs = await getAllSessions()

    // then
    expect(sessionIDs.slice(0, 3)).toEqual(["ses_new", "ses_mid", "ses_old"])
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

    const { setStorageClient, readSessionMessages } = await import("./storage")
    setStorageClient(unsafeTestValue<Parameters<typeof setStorageClient>[0]>(mockClient))

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

    const { setStorageClient, readSessionTodos } = await import("./storage")
    setStorageClient(unsafeTestValue<Parameters<typeof setStorageClient>[0]>(mockClient))

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

  test("SDK path rethrows non-transport errors", async () => {
    // given
    mockClient.session.messages.mockImplementation(() => Promise.reject(new Error("API error")))

    const { setStorageClient, readSessionMessages } = await import("./storage")
    setStorageClient(unsafeTestValue<Parameters<typeof setStorageClient>[0]>(mockClient))

    await expect(readSessionMessages("ses_test")).rejects.toThrow("API error")
  })

  test("SDK path returns empty array when client is not set", async () => {
    //#given beta mode enabled but no client set
    //#when client is explicitly cleared and messages are requested
    const { resetStorageClient, readSessionMessages } = await import("./storage")
    resetStorageClient()
    const messages = await readSessionMessages("ses_test")

    //#then should return empty array since no client and no JSON fallback
    expect(messages).toEqual([])
  })
})
