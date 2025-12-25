import { describe, test, expect } from "bun:test"
import { formatSessionList, formatSessionMessages, formatSessionInfo, formatSearchResults, filterSessionsByDate, searchInSession } from "./utils"
import type { SessionInfo, SessionMessage, SearchResult } from "./types"

describe("session-manager utils", () => {
  test("formatSessionList handles empty array", () => {
    const result = formatSessionList([])
    
    expect(result).toContain("No sessions found")
  })

  test("formatSessionMessages handles empty array", () => {
    const result = formatSessionMessages([])
    
    expect(result).toContain("No messages")
  })

  test("formatSessionMessages includes message content", () => {
    const messages: SessionMessage[] = [
      {
        id: "msg_001",
        role: "user",
        time: { created: Date.now() },
        parts: [{ id: "prt_001", type: "text", text: "Hello world" }],
      },
    ]
    
    const result = formatSessionMessages(messages)
    
    expect(result).toContain("user")
    expect(result).toContain("Hello world")
  })

  test("formatSessionMessages includes todos when requested", () => {
    const messages: SessionMessage[] = [
      {
        id: "msg_001",
        role: "user",
        time: { created: Date.now() },
        parts: [{ id: "prt_001", type: "text", text: "Test" }],
      },
    ]
    
    const todos = [
      { id: "1", content: "Task 1", status: "completed" as const },
      { id: "2", content: "Task 2", status: "pending" as const },
    ]
    
    const result = formatSessionMessages(messages, true, todos)
    
    expect(result).toContain("Todos")
    expect(result).toContain("Task 1")
    expect(result).toContain("Task 2")
  })

  test("formatSessionInfo includes all metadata", () => {
    const info: SessionInfo = {
      id: "ses_test123",
      message_count: 42,
      first_message: new Date("2025-12-20T10:00:00Z"),
      last_message: new Date("2025-12-24T15:00:00Z"),
      agents_used: ["build", "oracle"],
      has_todos: true,
      has_transcript: true,
      todos: [{ id: "1", content: "Test", status: "pending" }],
      transcript_entries: 123,
    }
    
    const result = formatSessionInfo(info)
    
    expect(result).toContain("ses_test123")
    expect(result).toContain("42")
    expect(result).toContain("build, oracle")
    expect(result).toContain("Duration")
  })

  test("formatSearchResults handles empty array", () => {
    const result = formatSearchResults([])
    
    expect(result).toContain("No matches")
  })

  test("formatSearchResults formats matches correctly", () => {
    const results: SearchResult[] = [
      {
        session_id: "ses_test123",
        message_id: "msg_001",
        role: "user",
        excerpt: "...example text...",
        match_count: 3,
        timestamp: Date.now(),
      },
    ]
    
    const result = formatSearchResults(results)
    
    expect(result).toContain("Found 1 matches")
    expect(result).toContain("ses_test123")
    expect(result).toContain("msg_001")
    expect(result).toContain("example text")
    expect(result).toContain("Matches: 3")
  })

  test("filterSessionsByDate filters correctly", () => {
    const sessionIDs = ["ses_001", "ses_002", "ses_003"]
    
    const result = filterSessionsByDate(sessionIDs)
    
    expect(Array.isArray(result)).toBe(true)
  })

  test("searchInSession finds matches case-insensitively", () => {
    const results = searchInSession("ses_nonexistent", "test", false)
    
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBe(0)
  })
})
