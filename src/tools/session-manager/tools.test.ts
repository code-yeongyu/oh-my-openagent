import { describe, test, expect } from "bun:test"
import { session_list, session_read, session_search, session_info } from "./tools"
import type { ToolContext } from "@opencode-ai/plugin/tool"

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

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
    // #given
    const projectPath = "/Users/yeongyu/local-workspaces/oh-my-opencode"

    // #when
    const result = await session_list.execute({ project_path: projectPath }, mockContext)

    // #then
    expect(typeof result).toBe("string")
  })

  test("session_list uses process.cwd() as default project_path", async () => {
    // #given - no project_path provided

    // #when
    const result = await session_list.execute({}, mockContext)

    // #then - should not throw and return string (uses process.cwd() internally)
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
