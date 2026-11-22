import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { preserveModuleMocksForTestFile } from "../../testing/module-mock-lifecycle"
import * as storageDetection from "../../shared/opencode-storage-detection"
import { MESSAGE_STORAGE, SESSION_STORAGE } from "../../shared/opencode-storage-paths"

const TEST_DIR = join(tmpdir(), `omo-test-session-manager-fallback-${randomUUID()}`)
const TEST_TODO_DIR = join(TEST_DIR, "todos")
const fixtureDirs = new Set<string>()

mock.module("./constants", () => ({
  TODO_DIR: TEST_TODO_DIR,
  TRANSCRIPT_DIR: join(TEST_DIR, "transcripts"),
}))
preserveModuleMocksForTestFile(import.meta.url)

afterAll(() => {
  mock.restore()
})

const storage = await import("./storage")

function createSdkUnavailableError(message: string): Error {
  return new Error(message)
}

function createSessionMetadata(projectID: string, sessionID: string, directory: string, updated: number): void {
  const projectDir = join(SESSION_STORAGE, projectID)
  fixtureDirs.add(projectDir)
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
  const sessionPath = join(MESSAGE_STORAGE, sessionID)
  fixtureDirs.add(sessionPath)
  mkdirSync(sessionPath, { recursive: true })
  writeFileSync(join(sessionPath, `${messageID}.json`), JSON.stringify({ id: messageID, role, time: { created } }))
}

function createSessionTodo(sessionID: string, items: Array<Record<string, unknown>>): void {
  mkdirSync(TEST_TODO_DIR, { recursive: true })
  writeFileSync(join(TEST_TODO_DIR, `${sessionID}.json`), JSON.stringify(items))
}

describe("session-manager storage fallback", () => {
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
    mockClient.session.list.mockReset()
    mockClient.session.messages.mockReset()
    mockClient.session.todo.mockReset()
    storage.setStorageClient(mockClient as never)
  })

  afterEach(() => {
    storage.resetStorageClient()
    restoreStorageDetection()
    for (const directory of fixtureDirs) {
      rmSync(directory, { recursive: true, force: true })
    }
    fixtureDirs.clear()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test("#given a legacy file-storage session the SQLite server answers NotFoundError for #when its messages are read #then the file copy is returned (#5854)", async () => {
    //#given
    createSessionMessage("ses_legacy", "msg_legacy", 1_000)
    mockClient.session.messages.mockImplementation(() =>
      Promise.resolve({ error: { name: "NotFoundError", data: { message: "Session not found: ses_legacy" } } }),
    )

    //#when
    const messages = await storage.readSessionMessages("ses_legacy")

    //#then
    expect(messages.map((message) => message.id)).toEqual(["msg_legacy"])
  })

  test("#given a legacy file-storage session the SQLite server answers NotFoundError for #when its info is read #then the file info is returned instead of an error (#5854)", async () => {
    //#given
    createSessionMessage("ses_legacy", "msg_legacy", 1_000)
    const notFound = { error: { name: "NotFoundError", data: { message: "Session not found: ses_legacy" } } }
    mockClient.session.messages.mockImplementation(() => Promise.resolve(notFound))
    mockClient.session.todo.mockImplementation(() => Promise.resolve(notFound))

    //#when
    const info = await storage.getSessionInfo("ses_legacy")

    //#then
    expect(info?.id).toBe("ses_legacy")
    expect(info?.message_count).toBe(1)
  })

  test("#given a session neither the SQLite server nor file storage has #when its existence is checked #then it is reported missing, not thrown (#5854)", async () => {
    //#given
    mockClient.session.messages.mockImplementation(() =>
      Promise.resolve({ error: { name: "NotFoundError", data: { message: "Session not found: ses_nowhere" } } }),
    )

    //#when
    const exists = await storage.sessionExists("ses_nowhere")

    //#then
    expect(exists).toBe(false)
  })

  test("#given the SQLite server answers a session read with a non-NotFound error body #when its messages are read #then it still rejects with that error's text", async () => {
    //#given
    mockClient.session.messages.mockImplementation(() =>
      Promise.resolve({ error: { name: "UnknownError", data: { message: "database disk image is malformed" } } }),
    )

    //#when
    const failure = await storage.readSessionMessages("ses_bad").then(
      () => undefined,
      (error: unknown) => error,
    )

    //#then
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe("UnknownError: database disk image is malformed")
  })

  test("#given one session whose SDK read fails with a non-NotFound error #when sessions are listed #then the others are listed and the failing one is named", async () => {
    //#given
    createSessionMessage("ses_ok", "msg_ok", 1_000)
    mockClient.session.messages.mockImplementation((input: unknown) => {
      const id = (input as { path: { id: string } }).path.id
      return Promise.resolve(
        id === "ses_bad"
          ? { error: { name: "UnknownError", data: { message: "database disk image is malformed" } } }
          : { data: [] },
      )
    })
    mockClient.session.todo.mockImplementation(() => Promise.resolve({ data: [] }))
    const { formatSessionList } = await import("./session-formatter")

    //#when
    const output = await formatSessionList(["ses_ok", "ses_bad"])

    //#then
    expect(output).toContain("ses_ok")
    expect(output).toContain(
      "Skipped 1 session that could not be read: ses_bad (UnknownError: database disk image is malformed)",
    )
    expect(output).not.toContain("[object Object]")
  })

  test("#given an SDK error body whose message says the server is unreachable #when a session is read #then it falls back to file storage like a thrown network error", async () => {
    //#given
    createSessionMessage("ses_file", "msg_file", 1_000)
    mockClient.session.messages.mockImplementation(() =>
      Promise.resolve({ error: { name: "UnknownError", data: { message: "fetch failed" } } }),
    )

    //#when
    const messages = await storage.readSessionMessages("ses_file")

    //#then
    expect(messages.map((message) => message.id)).toEqual(["msg_file"])
  })

  test("#given unreachable SDK list response #when getMainSessions runs #then falls back to file sessions", async () => {
    createSessionMetadata("proj_test", "ses_file", "/workspace/project", 2_000)
    mockClient.session.list.mockImplementation(() =>
      Promise.resolve({ error: createSdkUnavailableError("fetch failed ECONNREFUSED") }),
    )

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
    mockClient.session.list.mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: "ses_sdk",
            projectID: "sdk_project",
            directory: "/workspace/project",
            time: { created: 3_000, updated: 4_000 },
          },
        ],
      }),
    )

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

  test("#given unavailable global SDK route and overlapping scoped/file sessions #when getAllSessions runs #then returns the scoped deduped union", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    createSessionMessage("ses_sdk", "msg_002", 2_000)
    mockClient.session.list.mockImplementation(() =>
      Promise.resolve({
        data: [{ id: "ses_sdk" }],
      }),
    )
    const globalList = mock(() => Promise.resolve({ error: { name: "NotFoundError" } }))
    storage.setStorageClient(mockClient as never, { experimental: { session: { list: globalList } } })

    const sessionIds = await storage.getAllSessions()

    expect(sessionIds).toEqual(["ses_sdk", "ses_file"])
    expect(globalList).toHaveBeenCalledWith({ limit: 100 })
  })

  test("#given 1000 global sessions #when bounded search and directory list run #then they stop paging after enough rows", async () => {
    const globalSessions = Array.from({ length: 1_000 }, (_, index) => ({
      id: `ses_global_${index}`,
      projectID: "other",
      directory: "/workspace/other",
      time: { created: 10_000 - index, updated: 10_000 - index },
    }))
    const globalList = mock((input?: { roots?: boolean; cursor?: number; limit?: number }): Promise<unknown> => {
      if (input?.roots) {
        const targetPage =
          input.cursor === 100
            ? ["ses_target_new", "ses_target_old"].map((id, index) => ({
                id,
                projectID: "target",
                directory: "/workspace/target",
                time: { created: 1_000 - index, updated: 1_000 - index },
              }))
            : Array.from({ length: 100 }, (_, index) => ({
                id: `ses_other_${index}`,
                projectID: "other",
                directory: "/workspace/other",
                time: { created: 5_000 - index, updated: 5_000 - index },
              }))
        return Promise.resolve({
          data: targetPage,
          response: new Response(null, {
            headers: input.cursor === 100 ? new Headers() : new Headers([["x-next-cursor", "100"]]),
          }),
        })
      }

      const start = input?.cursor ?? 0
      const page = globalSessions.slice(start, start + (input?.limit ?? 100))
      const nextCursor = start + page.length
      return Promise.resolve({
        data: page,
        response: new Response(null, {
          headers:
            nextCursor < globalSessions.length ? new Headers([["x-next-cursor", String(nextCursor)]]) : new Headers(),
        }),
      })
    })
    storage.setStorageClient(mockClient as never, { experimental: { session: { list: globalList } } })

    const mainSessions = await storage.getMainSessions({ directory: "/workspace/target", limit: 2 })
    const allSessionIDs = await storage.getAllSessions(50)

    expect(globalList).toHaveBeenCalledTimes(3)
    expect(mainSessions.map((session) => session.id)).toEqual(["ses_target_new", "ses_target_old"])
    expect(allSessionIDs).toEqual(globalSessions.slice(0, 50).map((session) => session.id))
    expect(globalList).toHaveBeenNthCalledWith(1, { roots: true, limit: 100 })
    expect(globalList).toHaveBeenNthCalledWith(2, { roots: true, cursor: 100, limit: 100 })
    expect(globalList).toHaveBeenNthCalledWith(3, { limit: 50 })
  })

  test("#given a project whose root sessions sit behind 600 newer ones #when getMainSessions filters by directory #then it pages until the cursor is exhausted", async () => {
    const rootSessions = [
      ...Array.from({ length: 600 }, (_, index) => ({
        id: `ses_other_${index}`,
        projectID: "other",
        directory: "/workspace/other",
        time: { created: 10_000 - index, updated: 10_000 - index },
      })),
      ...["ses_target_new", "ses_target_old"].map((id, index) => ({
        id,
        projectID: "target",
        directory: "/workspace/target",
        time: { created: 1_000 - index, updated: 1_000 - index },
      })),
    ]
    const globalList = mock((input?: { roots?: boolean; cursor?: number; limit?: number }): Promise<unknown> => {
      const start = input?.cursor ?? 0
      const page = rootSessions.slice(start, start + (input?.limit ?? 100))
      const nextCursor = start + page.length
      return Promise.resolve({
        data: page,
        response: new Response(null, {
          headers:
            nextCursor < rootSessions.length ? new Headers([["x-next-cursor", String(nextCursor)]]) : new Headers(),
        }),
      })
    })
    storage.setStorageClient(mockClient as never, { experimental: { session: { list: globalList } } })

    const sessions = await storage.getMainSessions({ directory: "/workspace/target" })

    expect(sessions.map((session) => session.id)).toEqual(["ses_target_new", "ses_target_old"])
  })

  test("#given unreachable SDK messages error #when readSessionMessages runs #then falls back to file messages", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.messages.mockImplementation(() =>
      Promise.reject(createSdkUnavailableError("Unable to connect to http://localhost:4096")),
    )

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
    mockClient.session.todo.mockImplementation(() =>
      Promise.resolve({ error: createSdkUnavailableError("network error: server unreachable") }),
    )

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

  test("#given unreachable SDK messages error #when sessionExists runs #then falls back to file existence", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.messages.mockImplementation(() =>
      Promise.reject(createSdkUnavailableError("ETIMEDOUT while connecting")),
    )

    const exists = await storage.sessionExists("ses_file")

    expect(exists).toBe(true)
  })

  test("#given empty SDK messages response #when sessionExists runs #then falls back to file existence", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.messages.mockImplementation(() => Promise.resolve({ data: [] }))

    const exists = await storage.sessionExists("ses_file")

    expect(exists).toBe(true)
  })

  test("#given session is absent from scoped SDK list but messages are readable by id #when sessionExists runs #then confirms existence by id", async () => {
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: [] }))
    mockClient.session.messages.mockImplementation((request: { path: { id: string } }) => {
      expect(request.path.id).toBe("ses_sqlite_scoped_out")
      return Promise.resolve({
        data: [{ info: { id: "msg_sdk", role: "user", time: { created: 1_000 } }, parts: [] }],
      })
    })

    const exists = await storage.sessionExists("ses_sqlite_scoped_out")

    expect(exists).toBe(true)
    expect(mockClient.session.messages).toHaveBeenCalledWith({
      path: { id: "ses_sqlite_scoped_out" },
      query: { limit: 1 },
    })
  })

  test("#given semantic SDK error #when readSessionMessages runs #then rethrows instead of hiding bug", async () => {
    mockClient.session.messages.mockImplementation(() => Promise.resolve({ error: new Error("session not found") }))

    await expect(storage.readSessionMessages("ses_missing")).rejects.toThrow("session not found")
  })

  test("#given SDK messages fail transiently then recover #when sessionExists runs #then retries SDK and avoids false-negative file fallback", async () => {
    // given a pure-sqlite session present by SDK id lookup but absent from file storage
    let attempts = 0
    mockClient.session.messages.mockImplementation(() => {
      attempts += 1
      if (attempts === 1) return Promise.reject(createSdkUnavailableError("fetch failed"))
      return Promise.resolve({
        data: [{ info: { id: "msg_sdk", role: "user", time: { created: 5_000 } }, parts: [] }],
      })
    })

    // when sessionExists hits a single transient SDK failure
    const exists = await storage.sessionExists("ses_sqlite_only")

    // then it retries the SDK and confirms existence instead of dropping to nonexistent file storage
    expect(exists).toBe(true)
    expect(attempts).toBe(2)
  })

  test("#given SDK messages fail transiently then recover #when readSessionMessages runs #then retries SDK instead of returning empty file storage", async () => {
    // given messages that live only in the SDK (pure-sqlite), not on disk
    let attempts = 0
    mockClient.session.messages.mockImplementation(() => {
      attempts += 1
      if (attempts === 1) return Promise.reject(createSdkUnavailableError("socket hang up"))
      return Promise.resolve({
        data: [{ info: { id: "msg_sdk", role: "user", time: { created: 5_000 } }, parts: [] }],
      })
    })

    // when readSessionMessages hits a single transient SDK failure
    const messages = await storage.readSessionMessages("ses_sqlite_only")

    // then it retries the SDK and returns the real messages
    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe("msg_sdk")
    expect(attempts).toBe(2)
  })

  test("#given non-transient SDK error #when readSessionMessages runs #then does not retry and rethrows immediately", async () => {
    let attempts = 0
    mockClient.session.messages.mockImplementation(() => {
      attempts += 1
      return Promise.resolve({ error: new Error("session not found") })
    })

    await expect(storage.readSessionMessages("ses_missing")).rejects.toThrow("session not found")
    expect(attempts).toBe(1)
  })
})
