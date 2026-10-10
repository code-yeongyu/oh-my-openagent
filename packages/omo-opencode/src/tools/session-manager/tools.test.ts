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
    getAllSessions: async () => ({ ids: ["ses_test123", "ses_test456"], archivedIds: new Set<string>() }),
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

describe("session-manager tools - archived sessions", () => {
  type CapturedCalls = {
    getAllSessionsOptions: Array<{ includeArchived?: boolean }>
    scannedSessionIds: string[]
    searchResults: Array<{ session_id: string; archived?: boolean }>
    formatSessionListCalls: Array<{ sessionIDs: string[]; archivedIds?: Set<string> }>
    getMainSessionsOptions: Array<{ directory?: string; includeArchived?: boolean }>
  }

  function createCapturingTools(overrides?: {
    getAllSessions?: (options: { includeArchived?: boolean }) => Promise<{ ids: string[]; archivedIds: Set<string> }>
    getMainSessions?: (options: { directory?: string; includeArchived?: boolean }) => Promise<SessionMetadata[]>
    searchInSession?: (sessionID: string) => Promise<SearchResult[]>
  }) {
    const captured: CapturedCalls = {
      getAllSessionsOptions: [],
      scannedSessionIds: [],
      searchResults: [],
      formatSessionListCalls: [],
      getMainSessionsOptions: [],
    }

    const tools = createSessionManagerTools(mockCtx, {
      setStorageClient: () => {},
      getMainSessions:
        overrides?.getMainSessions ??
        (async (options) => {
          captured.getMainSessionsOptions.push(options)
          return []
        }),
      getAllSessions:
        overrides?.getAllSessions ??
        (async (options) => {
          captured.getAllSessionsOptions.push(options)
          return { ids: [], archivedIds: new Set<string>() }
        }),
      searchInSession:
        overrides?.searchInSession ??
        (async (sessionID) => {
          captured.scannedSessionIds.push(sessionID)
          return [
            {
              session_id: sessionID,
              message_id: `${sessionID}-msg`,
              excerpt: "hit",
              role: "user",
              match_count: 1,
            },
          ]
        }),
      formatSearchResults: (results) => {
        captured.searchResults.push(...results.map((r) => ({ session_id: r.session_id, archived: r.archived })))
        return `results:${results.length}`
      },
      formatSessionList: async (sessionIDs, archivedIds) => {
        captured.formatSessionListCalls.push({ sessionIDs, archivedIds })
        return `sessions:${sessionIDs.join(",")}`
      },
      sessionExists: async () => true,
      readSessionMessages: async () => [],
      readSessionTodos: async () => [],
      filterSessionsByDate: async (sessionIDs) => sessionIDs,
      formatSessionMessages: () => "messages:0",
      getSessionInfo: async () => null,
      formatSessionInfo: () => "info:none",
    })

    return { tools, captured }
  }

  test("session_search scans archived sessions by default", async () => {
    //#given
    const { tools, captured } = createCapturingTools({
      getAllSessions: async (options) => {
        captured.getAllSessionsOptions.push(options)
        return {
          ids: ["ses_active", "ses_archived"],
          archivedIds: new Set(["ses_archived"]),
        }
      },
    })

    //#when
    await tools.session_search.execute({ query: "needle" }, mockContext)

    //#then
    expect(captured.getAllSessionsOptions).toEqual([{ includeArchived: true }])
    expect(captured.scannedSessionIds).toEqual(["ses_active", "ses_archived"])
  })

  test("session_search honors include_archived false", async () => {
    //#given
    const { tools, captured } = createCapturingTools({
      getAllSessions: async (options) => {
        captured.getAllSessionsOptions.push(options)
        return { ids: ["ses_active"], archivedIds: new Set<string>() }
      },
    })

    //#when
    await tools.session_search.execute({ query: "needle", include_archived: false }, mockContext)

    //#then
    expect(captured.getAllSessionsOptions).toEqual([{ includeArchived: false }])
    expect(captured.scannedSessionIds).toEqual(["ses_active"])
  })

  test("session_search marks matches from archived sessions", async () => {
    //#given
    const { tools, captured } = createCapturingTools({
      getAllSessions: async () => ({
        ids: ["ses_active", "ses_archived"],
        archivedIds: new Set(["ses_archived"]),
      }),
    })

    //#when
    await tools.session_search.execute({ query: "needle" }, mockContext)

    //#then
    expect(captured.searchResults).toEqual([
      { session_id: "ses_active", archived: undefined },
      { session_id: "ses_archived", archived: true },
    ])
  })

  test("session_search result limit still applies with archived sessions in the scan", async () => {
    //#given
    const { tools, captured } = createCapturingTools({
      getAllSessions: async () => ({
        ids: ["ses_active", "ses_archived"],
        archivedIds: new Set(["ses_archived"]),
      }),
    })

    //#when
    await tools.session_search.execute({ query: "needle", limit: 1 }, mockContext)

    //#then
    expect(captured.scannedSessionIds).toEqual(["ses_active"])
  })

  test("session_list excludes archived sessions by default", async () => {
    //#given
    const { tools, captured } = createCapturingTools()

    //#when
    await tools.session_list.execute({}, mockContext)

    //#then
    expect(captured.getMainSessionsOptions).toEqual([{ directory: projectDir, includeArchived: false }])
    expect(captured.formatSessionListCalls[0]?.archivedIds?.size).toBe(0)
  })

  test("session_list honors include_archived true and marks archived rows", async () => {
    //#given
    const archivedMetadata: SessionMetadata = {
      id: "ses_archived",
      projectID: "project-1",
      directory: projectDir,
      time: { created: 1000, updated: 2000, archived: 1500 },
    }
    const activeMetadata: SessionMetadata = {
      id: "ses_active",
      projectID: "project-1",
      directory: projectDir,
      time: { created: 1000, updated: 3000 },
    }
    const { tools, captured } = createCapturingTools({
      getMainSessions: async (options) => {
        captured.getMainSessionsOptions.push(options)
        return [activeMetadata, archivedMetadata]
      },
    })

    //#when
    await tools.session_list.execute({ include_archived: true }, mockContext)

    //#then
    expect(captured.getMainSessionsOptions).toEqual([{ directory: projectDir, includeArchived: true }])
    expect(captured.formatSessionListCalls[0]?.sessionIDs).toEqual(["ses_active", "ses_archived"])
    expect(captured.formatSessionListCalls[0]?.archivedIds).toEqual(new Set(["ses_archived"]))
  })
})
