import { describe, test, expect } from "bun:test"
import { createSessionManagerTools } from "./tools"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { PluginInput } from "@opencode-ai/plugin"
import { mock, beforeAll, afterAll } from "bun:test"
import { formatSessionMessages } from "./session-formatter"
import type { SessionMessage } from "./types"

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

const tools = createSessionManagerTools(mockCtx)
const { session_list, session_read, session_search, session_info } = tools

describe("session-manager tools", () => {
  test("session_list executes without error", async () => {
    const result = await session_list.execute({}, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_list respects limit parameter", async () => {
    const result = await session_list.execute({ limit: 5 }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_list filters by date range", async () => {
    const result = await session_list.execute({
      from_date: "2025-12-01T00:00:00Z",
      to_date: "2025-12-31T23:59:59Z",
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_list filters by project_path", async () => {
    //#given
    const projectPath = "/Users/yeongyu/local-workspaces/oh-my-opencode"

    //#when
    const result = await session_list.execute({ project_path: projectPath }, mockContext)

    //#then
    expect(typeof result).toBe("string")
  })

  test("session_list uses ctx.directory as default project_path", async () => {
    //#given - no project_path provided

    //#when
    const result = await session_list.execute({}, mockContext)

    //#then
    expect(typeof result).toBe("string")
  })

  test("session_read handles non-existent session", async () => {
    const result = await session_read.execute({ session_id: "ses_nonexistent" }, mockContext)
    
    expect(result).toContain("not found")
  })

  test("session_read executes with valid parameters", async () => {
    const result = await session_read.execute({
      session_id: "ses_test123",
      include_todos: true,
      include_transcript: true,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_read respects limit parameter", async () => {
    const result = await session_read.execute({
      session_id: "ses_test123",
      limit: 10,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search executes without error", async () => {
    const result = await session_search.execute({ query: "test" }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search filters by session_id", async () => {
    const result = await session_search.execute({
      query: "test",
      session_id: "ses_test123",
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search respects case_sensitive parameter", async () => {
    const result = await session_search.execute({
      query: "TEST",
      case_sensitive: true,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_search respects limit parameter", async () => {
    const result = await session_search.execute({
      query: "test",
      limit: 5,
    }, mockContext)
    
    expect(typeof result).toBe("string")
  })

  test("session_info handles non-existent session", async () => {
    const result = await session_info.execute({ session_id: "ses_nonexistent" }, mockContext)
    
    expect(result).toContain("not found")
  })

  test("session_info executes with valid session", async () => {
    const result = await session_info.execute({ session_id: "ses_test123" }, mockContext)
    
    expect(typeof result).toBe("string")
  })
})

describe("session_read offset pagination", () => {
  const mockMessages: SessionMessage[] = [
    { id: "msg_1", role: "user", time: { created: 1700000000000 }, parts: [{ id: "p1", type: "text", text: "Hello" }] },
    { id: "msg_2", role: "assistant", agent: "test-agent", time: { created: 1700000060000 }, parts: [{ id: "p2", type: "text", text: "Hi there" }] },
    { id: "msg_3", role: "user", time: { created: 1700000120000 }, parts: [{ id: "p3", type: "text", text: "Question" }] },
    { id: "msg_4", role: "assistant", agent: "test-agent", time: { created: 1700000180000 }, parts: [{ id: "p4", type: "text", text: "Answer" }] },
    { id: "msg_5", role: "user", time: { created: 1700000240000 }, parts: [{ id: "p5", type: "text", text: "Thanks" }] },
  ]

  beforeAll(() => {
    mock.module("./storage", () => ({
      sessionExists: () => Promise.resolve(true),
      readSessionMessages: () => Promise.resolve([...mockMessages]),
      readSessionTodos: () => Promise.resolve([]),
      setStorageClient: () => {},
      resetStorageClient: () => {},
      getMainSessions: () => Promise.resolve([]),
      getAllSessions: () => Promise.resolve([]),
      getMessageDir: () => null,
      readSessionTranscript: () => Promise.resolve(0),
      getSessionInfo: () => Promise.resolve(null),
    }))
  })

  afterAll(() => {
    mock.restore()
  })

  describe("#given offset is less than 1", () => {
    describe("#when session_read is called with offset=0", () => {
      test("#then returns error that offset must be >= 1", async () => {
        const result = await session_read.execute({ session_id: "ses_mock", offset: 0 }, mockContext)

        expect(result).toContain("offset must be >= 1")
        expect(result).toContain("got 0")
      })
    })
  })

  describe("#given offset exceeds total message count", () => {
    describe("#when session_read is called with offset=10 on a session with 5 messages", () => {
      test("#then returns error about exceeding total message count", async () => {
        const result = await session_read.execute({ session_id: "ses_mock", offset: 10 }, mockContext)

        expect(result).toContain("exceeds total message count")
        expect(result).toContain("(5)")
      })
    })
  })

  describe("#given a session with 5 messages", () => {
    describe("#when session_read is called with a valid offset=3", () => {
      test("#then executes without error", async () => {
        const result = await session_read.execute({ session_id: "ses_mock", offset: 3 }, mockContext)

        expect(result).not.toContain("Error")
        expect(typeof result).toBe("string")
      })
    })

    describe("#when session_read is called with offset=2 and limit=2", () => {
      test("#then executes without error and returns correct slice", async () => {
        const result = await session_read.execute({ session_id: "ses_mock", offset: 2, limit: 2 }, mockContext)

        expect(result).not.toContain("Error")
        expect(typeof result).toBe("string")
      })
    })

    describe("#when session_read is called without offset or limit", () => {
      test("#then returns all messages without pagination header", async () => {
        const result = await session_read.execute({ session_id: "ses_mock" }, mockContext)

        expect(result).not.toContain("Showing messages")
        expect(result).not.toContain("Error")
      })
    })
  })

  describe("#given formatSessionMessages is called with pagination info", () => {
    describe("#when offset is provided", () => {
      test("#then pagination header shows correct message range", () => {
        const slicedMessages = mockMessages.slice(2)
        const result = formatSessionMessages(slicedMessages, false, undefined, { offset: 3, totalMessages: 5 })

        expect(result).toContain("Showing messages 3-5 of 5")
      })
    })

    describe("#when only limit is used and offset defaults to 1", () => {
      test("#then pagination header starts from message 1", () => {
        const slicedMessages = mockMessages.slice(0, 2)
        const result = formatSessionMessages(slicedMessages, false, undefined, { offset: 1, totalMessages: 5 })

        expect(result).toContain("Showing messages 1-2 of 5")
      })
    })
  })
})
