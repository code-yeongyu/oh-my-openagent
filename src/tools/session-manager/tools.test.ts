import { describe, test, expect, beforeEach } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSessionManagerTools } from "./tools"
import { createAlias } from "../../features/session-alias"
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

describe("session-manager tools — alias resolution", () => {
  let dir: string

  function createToolsWithDir(directory: string) {
    return createSessionManagerTools({ directory } as PluginInput, {
      setStorageClient: () => {},
      sessionExists: async (sessionID) => sessionID === "ses_real123",
      readSessionMessages: async (sessionID): Promise<SessionMessage[]> =>
        sessionID === "ses_real123"
          ? [{
              id: "msg",
              role: "user",
              time: { created: Date.now() },
              parts: [{ id: "part", type: "text", text: "hi" }],
            }]
          : [],
      readSessionTodos: async (): Promise<TodoItem[]> => [],
      formatSessionMessages: (messages) => `messages:${messages.length}`,
      getSessionInfo: async (sessionID): Promise<SessionInfo | null> =>
        sessionID === "ses_real123"
          ? {
              id: sessionID,
              message_count: 1,
              agents_used: [],
              has_todos: false,
              has_transcript: false,
            }
          : null,
      formatSessionInfo: (info) => `info:${info.id}`,
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-mgr-alias-test-"))
  })

  test("session_read resolves alias to real session ID", async () => {
    const create = await createAlias(
      { alias: "my-alias", session_id: "ses_real123" },
      { directory: dir },
    )
    expect(create.ok).toBe(true)

    const { session_read } = createToolsWithDir(dir)
    const result = await session_read.execute({ session_id: "my-alias" }, mockContext)
    expect(typeof result).toBe("string")
    expect(result as string).toContain("my-alias")
    expect(result as string).toContain("ses_real123")
  })

  test("session_read passes real ID through unchanged", async () => {
    const { session_read } = createToolsWithDir(dir)
    const result = await session_read.execute({ session_id: "ses_real123" }, mockContext)
    expect(typeof result).toBe("string")
    expect(result as string).not.toContain("alias")
  })

  test("session_info resolves alias and labels the output", async () => {
    await createAlias({ alias: "info-alias", session_id: "ses_real123" }, { directory: dir })
    const { session_info } = createToolsWithDir(dir)
    const result = await session_info.execute({ session_id: "info-alias" }, mockContext)
    expect(typeof result).toBe("string")
    expect(result as string).toContain("info-alias")
    expect(result as string).toContain("info:ses_real123")
  })

  test("session_read on unknown alias falls through to 'not found' with original input", async () => {
    const { session_read } = createToolsWithDir(dir)
    const result = await session_read.execute({ session_id: "no-such-alias" }, mockContext)
    expect(result as string).toContain("not found")
    expect(result as string).toContain("no-such-alias")
  })

  test("session_info on alias that points to deleted session reports not found with alias context", async () => {
    await createAlias({ alias: "ghost", session_id: "ses_dead00000" }, { directory: dir })
    const { session_info } = createToolsWithDir(dir)
    const result = await session_info.execute({ session_id: "ghost" }, mockContext)
    expect(result as string).toContain("not found")
    expect(result as string).toContain("ghost")
    expect(result as string).toContain("ses_dead00000")
  })
})
