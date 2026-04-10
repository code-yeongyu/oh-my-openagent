import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"

const setStorageClientMock = mock(() => {})
const sessionExistsMock = mock(async () => true)
const readSessionMessagesMock = mock(async () => [])
const readSessionTodosMock = mock(async () => [])
const formatSessionMessagesMock = mock(() => "formatted session output")
const formatSearchResultsMock = mock(() => "formatted search output")
const searchInSessionMock = mock(async () => [])
const getAllSessionsMock = mock(async () => ["ses_alpha"])
const getMainSessionsMock = mock(async () => ["ses_alpha"])
const getSessionInfoMock = mock(async () => null)
const filterSessionsByDateMock = mock(async (sessionIDs: string[]) => sessionIDs)
const formatSessionListMock = mock(async () => "formatted session list")
const formatSessionInfoMock = mock(() => "formatted session info")

mock.module("./storage", () => ({
  setStorageClient: setStorageClientMock,
  sessionExists: sessionExistsMock,
  readSessionMessages: readSessionMessagesMock,
  readSessionTodos: readSessionTodosMock,
  getAllSessions: getAllSessionsMock,
  getMainSessions: getMainSessionsMock,
  getSessionInfo: getSessionInfoMock,
}))

mock.module("./session-formatter", () => ({
  filterSessionsByDate: filterSessionsByDateMock,
  formatSessionInfo: formatSessionInfoMock,
  formatSessionList: formatSessionListMock,
  formatSessionMessages: formatSessionMessagesMock,
  formatSearchResults: formatSearchResultsMock,
  searchInSession: searchInSessionMock,
}))

const { createSessionManagerTools } = await import(`./tools?test=compat-${Date.now()}-${Math.random()}`)
mock.restore()

const mockCtx = { directory: "/test/project", client: undefined } as PluginInput

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: "/test/project",
  worktree: "/test/project",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

afterEach(() => {
  setStorageClientMock.mockClear()
  sessionExistsMock.mockClear()
  readSessionMessagesMock.mockClear()
  readSessionTodosMock.mockClear()
  formatSessionMessagesMock.mockClear()
  formatSearchResultsMock.mockClear()
  searchInSessionMock.mockClear()
  getAllSessionsMock.mockClear()
  getMainSessionsMock.mockClear()
  getSessionInfoMock.mockClear()
  filterSessionsByDateMock.mockClear()
  formatSessionListMock.mockClear()
  formatSessionInfoMock.mockClear()

  sessionExistsMock.mockImplementation(async () => true)
  readSessionMessagesMock.mockImplementation(async () => [])
  readSessionTodosMock.mockImplementation(async () => [])
  formatSessionMessagesMock.mockImplementation(() => "formatted session output")
  formatSearchResultsMock.mockImplementation(() => "formatted search output")
  searchInSessionMock.mockImplementation(async () => [])
  getAllSessionsMock.mockImplementation(async () => ["ses_alpha"])
  getMainSessionsMock.mockImplementation(async () => ["ses_alpha"])
  getSessionInfoMock.mockImplementation(async () => null)
  filterSessionsByDateMock.mockImplementation(async (sessionIDs: string[]) => sessionIDs)
  formatSessionListMock.mockImplementation(async () => "formatted session list")
	formatSessionInfoMock.mockImplementation(() => "formatted session info")
})

afterAll(() => {})

describe("session-manager legacy compatibility", () => {
  test("find_sessions stays an alias of the canonical session_search tool and returns OMO-native formatted output", async () => {
    // given
    searchInSessionMock.mockImplementation(async () => [
      {
        session_id: "ses_alpha",
        message_id: "msg_1",
        role: "user",
        excerpt: "auth excerpt",
        match_count: 2,
        timestamp: 123,
      },
    ])

    const tools = createSessionManagerTools(mockCtx)

    // when
    const result = await tools.find_sessions.execute({ query: "auth", limit: 5 }, mockContext)

    // then
    expect(tools.find_sessions).toBe(tools.session_search)
    expect(result).toBe("formatted search output")
    expect(searchInSessionMock).toHaveBeenCalledWith("ses_alpha", "auth", undefined, 5)
    expect(formatSearchResultsMock.mock.calls.at(-1)?.[0]).toEqual([
      {
        session_id: "ses_alpha",
        message_id: "msg_1",
        role: "user",
        excerpt: "auth excerpt",
        match_count: 2,
        timestamp: 123,
      },
    ])
  })

  test("read_session stays an alias of the canonical session_read tool and keeps OMO-native text output", async () => {
    // given
    readSessionMessagesMock.mockImplementation(async () => [
      {
        id: "msg_1",
        role: "user",
        parts: [{ id: "part_1", type: "text", text: "hello" }],
      },
    ])
    formatSessionMessagesMock.mockImplementation(() => "Session: readable text")

    const tools = createSessionManagerTools(mockCtx)

    // when
    const result = await tools.read_session.execute({ session_id: "ses_alpha" }, mockContext)

    // then
    expect(tools.read_session).toBe(tools.session_read)
    expect(result).toBe("Session: readable text")
    expect(result.startsWith("{")).toBe(false)
  })

  test("read_session focus filters messages through the OMO-owned path before formatting", async () => {
    // given
    readSessionMessagesMock.mockImplementation(async () => [
      {
        id: "msg_auth",
        role: "user",
        parts: [{ id: "part_auth", type: "text", text: "Investigate auth regression" }],
      },
      {
        id: "msg_other",
        role: "assistant",
        parts: [{ id: "part_other", type: "text", text: "Unrelated deployment note" }],
      },
    ])

    const tools = createSessionManagerTools(mockCtx)

    // when
    await tools.read_session.execute({ session_id: "ses_alpha", focus: "auth" }, mockContext)

    // then
    const filteredMessages = formatSessionMessagesMock.mock.calls.at(-1)?.[0]
    expect(filteredMessages).toEqual([
      {
        id: "msg_auth",
        role: "user",
        parts: [{ id: "part_auth", type: "text", text: "Investigate auth regression" }],
      },
    ])
  })
})
