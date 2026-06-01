import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { SessionMessage, SearchResult } from "./types"

const mockMessages: Map<string, SessionMessage[]> = new Map()

mock.module("./storage", () => ({
  readSessionMessages: async (sessionID: string) => mockMessages.get(sessionID) ?? [],
}))

const { searchInSession, formatSearchResults } = await import("./session-formatter")

function makeMessage(id: string, role: "user" | "assistant", text: string, created = Date.now()): SessionMessage {
  return {
    id,
    role,
    time: { created },
    parts: [{ id: `${id}-part`, type: "text", text }],
  }
}

describe("session-formatter — searchInSession position", () => {
  beforeEach(() => {
    mockMessages.clear()
  })

  test("returns correct offsets and totals for multi-message session with matches at beginning, middle, end, and gaps", async () => {
    //#given — 7 messages, "needle" at positions 0, 3, and 6
    mockMessages.set("ses_multi", [
      makeMessage("msg_0", "user", "find the needle at start"),
      makeMessage("msg_1", "assistant", "nothing here"),
      makeMessage("msg_2", "assistant", "nothing here either"),
      makeMessage("msg_3", "user", "needle in the middle"),
      makeMessage("msg_4", "assistant", "no match"),
      makeMessage("msg_5", "assistant", "still no match"),
      makeMessage("msg_6", "user", "final needle at end"),
    ])

    //#when
    const results = await searchInSession("ses_multi", "needle")

    //#then — 3 matches at offsets 0, 3, 6; all share total 7
    expect(results).toHaveLength(3)
    expect(results[0].message_offset).toBe(0)
    expect(results[1].message_offset).toBe(3)
    expect(results[2].message_offset).toBe(6)
    for (const r of results) {
      expect(r.total_messages).toBe(7)
    }
    // non-existent session
    expect(await searchInSession("ses_ghost", "anything")).toHaveLength(0)
    // session exists but no matches
    mockMessages.set("ses_nomatch", [makeMessage("m0", "user", "hello"), makeMessage("m1", "assistant", "world")])
    expect(await searchInSession("ses_nomatch", "missing")).toHaveLength(0)
  })
})

describe("session-formatter — formatSearchResults position", () => {
  test("renders position: offset / total for multiple results and returns no-match for empty", () => {
    //#given
    const results: SearchResult[] = [
      {
        session_id: "ses_abc",
        message_id: "msg_001",
        role: "user",
        excerpt: "...first match...",
        match_count: 1,
        message_offset: 0,
        total_messages: 45,
      },
      {
        session_id: "ses_def",
        message_id: "msg_012",
        role: "user",
        excerpt: "...second match...",
        match_count: 2,
        message_offset: 11,
        total_messages: 30,
      },
    ]

    //#when
    const output = formatSearchResults(results)
    const lines = output.split("\n")

    //#then — position lines present with correct values
    expect(output).toContain("position: 0 / 45")
    expect(output).toContain("position: 11 / 30")
    // position line sits between header and excerpt
    const headerIdx = lines.findIndex((l) => l.includes("[ses_abc]"))
    expect(lines[headerIdx + 1]).toContain("position: 0 / 45")
    expect(lines[headerIdx + 2]).toContain("first match")
    // empty input
    expect(formatSearchResults([])).toBe("No matches found.")
  })
})
