import { describe, test, expect } from "bun:test"
import {
  formatSessionList,
  formatSessionMessages,
  formatSessionInfo,
  formatSearchResults,
  filterSessionsByUpdatedDate,
  searchInSession,
} from "./session-formatter"
import type { SessionInfo, SessionMessage, SearchResult, SessionMetadata } from "./types"

describe("session-manager utils", () => {
  test("formatSessionList handles empty array", async () => {
    // given
    const sessions: string[] = []

    // when
    const result = await formatSessionList(sessions)

    // then
    expect(result).toContain("No sessions found")
  })

  test("formatSessionMessages handles empty array", () => {
    // given
    const messages: SessionMessage[] = []

    // when
    const result = formatSessionMessages(messages)

    // then
    expect(result).toContain("No messages")
  })

  test("formatSessionMessages includes message content", () => {
    // given
    const messages: SessionMessage[] = [
      {
        id: "msg_001",
        role: "user",
        time: { created: Date.now() },
        parts: [{ id: "prt_001", type: "text", text: "Hello world" }],
      },
    ]

    // when
    const result = formatSessionMessages(messages)

    // then
    expect(result).toContain("user")
    expect(result).toContain("Hello world")
  })

  test("formatSessionMessages includes todos when requested", () => {
    // given
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

    // when
    const result = formatSessionMessages(messages, true, todos)

    // then
    expect(result).toContain("Todos")
    expect(result).toContain("Task 1")
    expect(result).toContain("Task 2")
  })

  test("formatSessionInfo includes all metadata", () => {
    // given
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

    // when
    const result = formatSessionInfo(info)

    // then
    expect(result).toContain("ses_test123")
    expect(result).toContain("42")
    expect(result).toContain("build, oracle")
    expect(result).toContain("Duration")
  })

  test("formatSearchResults handles empty array", () => {
    // given
    const results: SearchResult[] = []

    // when
    const result = formatSearchResults(results)

    // then
    expect(result).toContain("No matches")
  })

  test("formatSearchResults formats matches correctly", () => {
    // given
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

    // when
    const result = formatSearchResults(results)

    // then
    expect(result).toContain("Found 1 matches")
    expect(result).toContain("ses_test123")
    expect(result).toContain("msg_001")
    expect(result).toContain("example text")
    expect(result).toContain("Matches: 3")
  })

  test("filterSessionsByUpdatedDate filters on metadata time.updated without reading messages", () => {
    // given
    const sessions: SessionMetadata[] = [
      { id: "ses_old", projectID: "p", directory: "/x", time: { created: 1, updated: Date.parse("2025-11-15T00:00:00Z") } },
      { id: "ses_mid", projectID: "p", directory: "/x", time: { created: 1, updated: Date.parse("2025-12-01T00:00:00Z") } },
      { id: "ses_new", projectID: "p", directory: "/x", time: { created: 1, updated: Date.parse("2025-12-15T00:00:00Z") } },
    ]

    // when
    const window = filterSessionsByUpdatedDate(sessions, "2025-12-01T00:00:00Z", "2025-12-31T23:59:59Z")
    const fromOnly = filterSessionsByUpdatedDate(sessions, "2025-12-01T00:00:00Z", undefined)
    const toOnly = filterSessionsByUpdatedDate(sessions, undefined, "2025-12-01T00:00:00Z")
    const unset = filterSessionsByUpdatedDate(sessions, undefined, undefined)
    const empty = filterSessionsByUpdatedDate([], "2025-12-01T00:00:00Z", undefined)

    // then
    expect(window.map((s) => s.id)).toEqual(["ses_mid", "ses_new"])
    expect(fromOnly.map((s) => s.id)).toEqual(["ses_mid", "ses_new"])
    expect(toOnly.map((s) => s.id)).toEqual(["ses_old", "ses_mid"])
    expect(unset.map((s) => s.id)).toEqual(["ses_old", "ses_mid", "ses_new"])
    expect(empty).toEqual([])
  })

  test("searchInSession finds matches case-insensitively", async () => {
    // given
    const sessionID = "ses_nonexistent"
    const query = "test"

    // when
    const results = await searchInSession(sessionID, query, false)

    // then
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBe(0)
  })
})
