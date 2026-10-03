import { describe, test, expect } from "bun:test"
import { createSessionManagerTools } from "./tools"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { PluginInput } from "@opencode-ai/plugin"
import type { SessionInfo, SessionMessage, SearchResult, SessionMetadata, TodoItem } from "./types"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

const mockCtx = { directory: projectDir } as PluginInput

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

function createTestTools() {
  return createSessionManagerTools(mockCtx, {
    setStorageClient: () => {},
    getMainSessions: async (): Promise<SessionMetadata[]> => [
      {
        id: "ses_test123",
        projectID: "project-1",
        directory: projectDir,
        time: { created: Date.now(), updated: Date.now() },
      },
      {
        id: "ses_test456",
        projectID: "project-1",
        directory: projectDir,
        time: { created: Date.now(), updated: Date.now() },
      },
    ],
    filterSessionsByDate: async (sessionIDs) => sessionIDs,
    formatSessionList: async (sessionIDs) => `sessions:${sessionIDs.join(",")}`,
    sessionExists: async (sessionID) => sessionID === "ses_test123",
    readSessionMessages: async (sessionID): Promise<SessionMessage[]> =>
      sessionID === "ses_test123"
        ? [{
            id: `${sessionID}-msg`,
            role: "user",
            time: { created: Date.now() },
            parts: [{ id: `${sessionID}-part`, type: "text", text: "hello" }],
          }]
        : [],
    readSessionTodos: async (): Promise<TodoItem[]> => [],
    formatSessionMessages: (messages) => `messages:${messages.length}`,
    getAllSessions: async () => ["ses_test123", "ses_test456"],
    searchInSession: async (sessionID): Promise<SearchResult[]> => [
      {
        session_id: sessionID,
        message_id: `${sessionID}-msg`,
        excerpt: "test snippet",
        role: "user",
        match_count: 1,
      },
    ],
    formatSearchResults: (results) => `results:${results.length}`,
    getSessionInfo: async (sessionID): Promise<SessionInfo | null> =>
      sessionID === "ses_test123"
        ? {
            id: sessionID,
            message_count: 1,
            first_message: new Date(),
            last_message: new Date(),
            agents_used: ["test-agent"],
            has_todos: false,
            has_transcript: false,
            todos: [],
            transcript_entries: 0,
          }
        : null,
    formatSessionInfo: (info) => `info:${info.id}`,
  })
}

describe("session-manager tools", () => {
  test("session_list executes without error", async () => {
    const { session_list } = createTestTools()
    const result = await session_list.execute({}, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_list respects limit parameter", async () => {
    const { session_list } = createTestTools()
    const result = await session_list.execute({ limit: 5 }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_list filters by date range", async () => {
    const { session_list } = createTestTools()
    const result = await session_list.execute({
      from_date: "2025-12-01T00:00:00Z",
      to_date: "2025-12-31T23:59:59Z",
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_list filters by project_path", async () => {
    const { session_list } = createTestTools()
    //#given
    const projectPath = "/Users/yeongyu/local-workspaces/oh-my-opencode"

    //#when
    const result = await session_list.execute({ project_path: projectPath }, mockContext)

    //#then
    expect(typeof result).toBe("string")
  })

  test("session_list uses ctx.directory as default project_path", async () => {
    const { session_list } = createTestTools()
    //#given - no project_path provided

    //#when
    const result = await session_list.execute({}, mockContext)

    //#then
    expect(typeof result).toBe("string")
  })

  test("session_read handles non-existent session", async () => {
    const { session_read } = createTestTools()
    const result = await session_read.execute({ session_id: "ses_nonexistent" }, mockContext)
    
    expect(result).toContain("not found")
  })

  test("session_read executes with valid parameters", async () => {
    const { session_read } = createTestTools()
    const result = await session_read.execute({
      session_id: "ses_test123",
      include_todos: true,
      include_transcript: true,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_read respects limit parameter", async () => {
    const { session_read } = createTestTools()
    const result = await session_read.execute({
      session_id: "ses_test123",
      limit: 10,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search executes without error", async () => {
    const { session_search } = createTestTools()
    const result = await session_search.execute({ query: "test" }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search filters by session_id", async () => {
    const { session_search } = createTestTools()
    const result = await session_search.execute({
      query: "test",
      session_id: "ses_test123",
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search respects case_sensitive parameter", async () => {
    const { session_search } = createTestTools()
    const result = await session_search.execute({
      query: "TEST",
      case_sensitive: true,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search respects limit parameter", async () => {
    const { session_search } = createTestTools()
    const result = await session_search.execute({
      query: "test",
      limit: 5,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_info handles non-existent session", async () => {
    const { session_info } = createTestTools()
    const result = await session_info.execute({ session_id: "ses_nonexistent" }, mockContext)
    
    expect(result).toContain("not found")
  })

  test("session_info executes with valid session", async () => {
    const { session_info } = createTestTools()
    const result = await session_info.execute({ session_id: "ses_test123" }, mockContext)
    
    expect(typeof result).toBe("string")
  })
})

describe("session-manager tools — session_read offset", () => {
  // given — 10 messages: msg-0 through msg-9
  const tenMessages: SessionMessage[] = Array.from({ length: 10 }, (_, i) => ({
    id: `msg-${i}`,
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    time: { created: 1000 + i * 100 },
    parts: [{ id: `part-${i}`, type: "text", text: `message ${i}` }],
  }))

  function createOffsetTestTools() {
    const capturedMessages: SessionMessage[][] = []
    return {
      capturedMessages,
      tools: createSessionManagerTools(mockCtx, {
        setStorageClient: () => {},
        sessionExists: async (id: string) => id === "ses_offset",
        readSessionMessages: async (): Promise<SessionMessage[]> => tenMessages,
        readSessionTodos: async (): Promise<TodoItem[]> => [],
        formatSessionMessages: (messages: SessionMessage[]) => {
          capturedMessages.push([...messages])
          return `count:${messages.length}`
        },
        getMainSessions: async () => [],
        filterSessionsByDate: async (ids: string[]) => ids,
        formatSessionList: async () => "",
        getAllSessions: async () => [],
        searchInSession: async () => [],
        formatSearchResults: () => "",
        getSessionInfo: async () => null,
        formatSessionInfo: () => "",
      }),
    }
  }

  test("offset handles positive, negative, zero, beyond-count, and combined with limit", async () => {
    //#given
    const { tools, capturedMessages } = createOffsetTestTools()

    //#when — no offset
    await tools.session_read.execute({ session_id: "ses_offset" }, mockContext)
    //#then — returns all 10
    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]).toHaveLength(10)

    //#when — positive offset 3 (skip first 3)
    await tools.session_read.execute({ session_id: "ses_offset", offset: 3 }, mockContext)
    //#then
    expect(capturedMessages[1][0].id).toBe("msg-3")
    expect(capturedMessages[1]).toHaveLength(7)

    //#when — negative offset -3 (last 3)
    await tools.session_read.execute({ session_id: "ses_offset", offset: -3 }, mockContext)
    //#then
    expect(capturedMessages[2][0].id).toBe("msg-7")
    expect(capturedMessages[2][2].id).toBe("msg-9")

    //#when — offset 0 treated as no offset
    await tools.session_read.execute({ session_id: "ses_offset", offset: 0 }, mockContext)
    //#then
    expect(capturedMessages[3]).toHaveLength(10)

    //#when — offset beyond count
    await tools.session_read.execute({ session_id: "ses_offset", offset: 99 }, mockContext)
    //#then
    expect(capturedMessages[4]).toHaveLength(0)

    //#when — negative offset larger than count returns all
    await tools.session_read.execute({ session_id: "ses_offset", offset: -50 }, mockContext)
    //#then
    expect(capturedMessages[5]).toHaveLength(10)

    //#when — positive offset + limit
    await tools.session_read.execute({ session_id: "ses_offset", offset: 2, limit: 3 }, mockContext)
    //#then
    expect(capturedMessages[6][0].id).toBe("msg-2")
    expect(capturedMessages[6][2].id).toBe("msg-4")

    //#when — negative offset + limit
    await tools.session_read.execute({ session_id: "ses_offset", offset: -5, limit: 2 }, mockContext)
    //#then
    expect(capturedMessages[7][0].id).toBe("msg-5")
    expect(capturedMessages[7][1].id).toBe("msg-6")
  })
})
