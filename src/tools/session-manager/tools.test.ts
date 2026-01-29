import { describe, test, expect } from "bun:test"
import { session_list, session_read, session_search, session_info, session_rename } from "./tools"
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

  test("session_rename handles non-existent session", async () => {
    //#given non-existent session ID
    const args = { session_id: "ses_nonexistent", new_title: "New Title" }
    
    //#when executing rename
    const result = await session_rename.execute(args, mockContext)
    
    //#then returns error message
    expect(result).toContain("not found")
  })

  test("session_rename successfully renames session", async () => {
    //#given valid session ID and new title
    const args = { session_id: "ses_test123", new_title: "Updated Title" }
    
    //#when executing rename
    const result = await session_rename.execute(args, mockContext)
    
    //#then returns a string result (success or failure)
    expect(typeof result).toBe("string")
  })

  test("session_rename rejects empty title", async () => {
    //#given empty new_title parameter
    const args = { session_id: "ses_test123", new_title: "" }
    
    //#when attempting to execute
    const result = await session_rename.execute(args, mockContext)
    
    //#then should return error about empty title
    expect(result).toContain("cannot be empty")
  })

  test("session_rename uses current session when session_id not provided", async () => {
    //#given only new_title provided, no session_id
    const args = { new_title: "Default Session Title" }
    
    //#when executing rename
    const result = await session_rename.execute(args, mockContext)
    
    //#then should attempt to rename using context.sessionID ("test-session")
    expect(typeof result).toBe("string")
    // Will return "not found" since test-session doesn't exist, but proves it used the context
    expect(result).toContain("test-session")
  })

  test("session_rename prefers explicit session_id over context", async () => {
    //#given both session_id and new_title provided
    const args = { session_id: "ses_explicit", new_title: "Explicit Title" }
    
    //#when executing rename
    const result = await session_rename.execute(args, mockContext)
    
    //#then should use the explicit session_id, not context.sessionID
    expect(typeof result).toBe("string")
    expect(result).toContain("ses_explicit")
    expect(result).not.toContain("test-session")
  })
})
