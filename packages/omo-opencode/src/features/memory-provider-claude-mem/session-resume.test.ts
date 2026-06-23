import { describe, expect, test } from "bun:test"
import { buildSessionContext } from "./session-resume"
import type { ClaudeMemSQLiteReader } from "./sqlite-reader"
import type { ObservationRow, SessionRow, SessionSummaryRow } from "./types"

type MockReaderMethods = {
  getSession?: (id: string) => SessionRow | null
  getSessionSummary?: (id: string) => SessionSummaryRow | null
  getSessionObservations?: (id: string, limit?: number) => ObservationRow[]
}

function makeReader(mock: MockReaderMethods): ClaudeMemSQLiteReader {
  return {
    getSession: mock.getSession ?? (() => null),
    getSessionSummary: mock.getSessionSummary ?? (() => null),
    getSessionObservations: mock.getSessionObservations ?? (() => []),
  } as unknown as ClaudeMemSQLiteReader
}

const baseSession: SessionRow = {
  id: 1,
  content_session_id: "content-1",
  memory_session_id: "mem-1",
  project: "super-agent",
  started_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  status: "active",
  custom_title: null,
}

describe("buildSessionContext", () => {
  describe("#given session missing in SQLite and no http client", () => {
    test("#when called #then returns undefined", async () => {
      const reader = makeReader({})

      const result = await buildSessionContext("missing-session", { sqliteReader: reader })

      expect(result).toBeUndefined()
    })
  })

  describe("#given session exists in SQLite and no http client", () => {
    test("#when called #then builds context from SQLite", async () => {
      const reader = makeReader({
        getSession: (id) => (id === "content-1" ? baseSession : null),
      })

      const result = await buildSessionContext("content-1", { sqliteReader: reader })

      expect(result).toBeDefined()
      expect(result?.session_id).toBe("content-1")
      expect(result?.project).toBe("super-agent")
      expect(result?.started_at).toBe("2026-01-01T00:00:00Z")
      expect(result?.observations).toEqual([])
    })
  })

  describe("#given session has a summary row", () => {
    test("#when resolved #then legacy summary_text is included", async () => {
      const summary: SessionSummaryRow = {
        memory_session_id: "mem-1",
        project: "super-agent",
        summary_text: "Implementation landed cleanly",
        created_at: "2026-01-01T01:00:00Z",
      }
      const reader = makeReader({
        getSession: () => baseSession,
        getSessionSummary: (id) => (id === "mem-1" ? summary : null),
      })

      const result = await buildSessionContext("content-1", { sqliteReader: reader })

      expect(result?.summary).toBe("Implementation landed cleanly")
    })

    test("#when resolved #then structured summary fields are formatted", async () => {
      const summary: SessionSummaryRow = {
        memory_session_id: "mem-1",
        project: "super-agent",
        request: "Restore Claude Mem summaries",
        learned: "session_summaries no longer has summary_text",
        completed: "Reader compatibility was updated",
        next_steps: "Verify startup context injection",
        created_at: "2026-01-01T01:00:00Z",
      }
      const reader = makeReader({
        getSession: () => baseSession,
        getSessionSummary: (id) => (id === "mem-1" ? summary : null),
      })

      const result = await buildSessionContext("content-1", { sqliteReader: reader })

      expect(result?.summary).toContain("Request: Restore Claude Mem summaries")
      expect(result?.summary).toContain("Learned: session_summaries no longer has summary_text")
      expect(result?.summary).toContain("Completed: Reader compatibility was updated")
    })
  })

  describe("#given session has recent observations", () => {
    test("#when resolved #then observations are mapped to L1SearchResult", async () => {
      const observations: ObservationRow[] = [
        {
          id: 1,
          memory_session_id: "mem-1",
          project: "super-agent",
          text: null,
          type: "discovery",
          title: "Found a bug",
          subtitle: "in auth module",
          facts: null,
          narrative: null,
          concepts: null,
          files_read: null,
          files_modified: null,
          prompt_number: null,
          discovery_tokens: 500,
          created_at: "2026-01-01T00:30:00Z",
          content_hash: "abc",
        },
      ]
      const reader = makeReader({
        getSession: () => baseSession,
        getSessionObservations: () => observations,
      })

      const result = await buildSessionContext("content-1", { sqliteReader: reader })

      expect(result?.observations).toHaveLength(1)
      const first = result?.observations[0]
      expect(first?.id).toBe("1")
      expect(first?.title).toBe("Found a bug")
      expect(first?.subtitle).toBe("in auth module")
      expect(first?.score).toBe(0.5)
      expect(first?.source).toBe("super-agent")
    })
  })
})
