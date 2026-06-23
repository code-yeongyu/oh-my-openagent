import { beforeAll, describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"
import { ClaudeMemSQLiteReader } from "./sqlite-reader"

function createFixtureDb(): Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE sdk_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_session_id TEXT UNIQUE NOT NULL,
      memory_session_id TEXT,
      project TEXT NOT NULL,
      user_prompt TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT DEFAULT 'active',
      worker_port INTEGER,
      prompt_counter INTEGER DEFAULT 0,
      custom_title TEXT
    );
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      text TEXT,
      type TEXT NOT NULL,
      title TEXT,
      subtitle TEXT,
      facts TEXT,
      narrative TEXT,
      concepts TEXT,
      files_read TEXT,
      files_modified TEXT,
      prompt_number INTEGER,
      discovery_tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      content_hash TEXT
    );
    CREATE TABLE session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      request TEXT,
      investigated TEXT,
      learned TEXT,
      completed TEXT,
      next_steps TEXT,
      files_read TEXT,
      files_edited TEXT,
      notes TEXT,
      prompt_number INTEGER,
      discovery_tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );
    CREATE TABLE pending_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_db_id INTEGER NOT NULL,
      content_session_id TEXT NOT NULL,
      message_type TEXT NOT NULL,
      tool_name TEXT,
      tool_input TEXT,
      tool_response TEXT,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      created_at_epoch INTEGER NOT NULL
    );
  `)

  db.exec(`
    INSERT INTO observations (memory_session_id, project, type, title, discovery_tokens, created_at)
    VALUES
      ('m_sess_1', 'super-agent', 'decision', 'Use Outbox pattern for consistency', 500, '2026-04-01T10:00:00Z'),
      ('m_sess_1', 'super-agent', 'discovery', 'Mem0 v2 search requires non-empty filters', 300, '2026-04-01T11:00:00Z'),
      ('m_sess_1', 'super-agent', 'bugfix', 'Fixed memory service stub error', 50, '2026-04-01T12:00:00Z'),
      ('m_sess_2', 'other-project', 'decision', 'Use Postgres for canonical storage', 400, '2026-04-02T10:00:00Z');

    INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, status)
    VALUES ('sess_abc', 'm_sess_1', 'super-agent', '2026-04-01T09:00:00Z', 'completed');

    INSERT INTO session_summaries (
      memory_session_id, project, request, investigated, learned, completed, next_steps,
      files_read, files_edited, notes, prompt_number, discovery_tokens, created_at, created_at_epoch
    )
    VALUES (
      'm_sess_1', 'super-agent', 'Fix memory architecture', 'Inspected SQLite fallback',
      'Current schemas store structured summary fields', 'Updated reader compatibility',
      'Run targeted tests', '["sqlite-reader.ts"]', '["session-resume.ts"]',
      'Session focused on memory architecture decisions', 7, 42,
      '2026-04-01T13:00:00Z', 1775048400000
    );

    INSERT INTO pending_messages (session_db_id, content_session_id, message_type, tool_name, status, created_at_epoch)
    VALUES (1, 'sess_abc', 'observation', 'Read', 'failed', 1775035800000);
  `)
  return db
}

let fixtureDb: Database
let reader: ClaudeMemSQLiteReader

describe("ClaudeMemSQLiteReader", () => {
  beforeAll(() => {
    fixtureDb = createFixtureDb()
    reader = new ClaudeMemSQLiteReader({ dbPath: ":memory:" })
    ;(reader as unknown as { db: Database }).db = fixtureDb
  })

  describe("#given isAvailable check", () => {
    describe("#when dbPath does not exist", () => {
      it("#then returns false", () => {
        const r = new ClaudeMemSQLiteReader({ dbPath: "/nonexistent/path.db" })
        expect(r.isAvailable()).toBe(false)
      })
    })
  })

  describe("#given observations in fixture DB", () => {
    describe("#when searchObservations is called with matching query", () => {
      it("#then returns rows whose title matches", () => {
        const results = reader.searchObservations("Outbox")
        expect(results.length).toBeGreaterThan(0)
        expect(results[0].title).toContain("Outbox")
      })
    })

    describe("#when searchObservations is called with obs_type filter", () => {
      it("#then returns only matching types", () => {
        const results = reader.searchObservations("", { obs_type: "decision" })
        expect(results.length).toBeGreaterThan(0)
        expect(results.every((r) => r.type === "decision")).toBe(true)
      })
    })

    describe("#when searchObservations is called with project filter", () => {
      it("#then returns only matching project rows", () => {
        const results = reader.searchObservations("", {
          project: "other-project",
        })
        expect(results.length).toBeGreaterThan(0)
        expect(results.every((r) => r.project === "other-project")).toBe(true)
      })
    })
  })

  describe("#given sessions in fixture DB", () => {
    describe("#when getSession is called with valid content_session_id", () => {
      it("#then returns the matching session", () => {
        const session = reader.getSession("sess_abc")
        expect(session).toBeDefined()
        expect(session?.project).toBe("super-agent")
        expect(session?.memory_session_id).toBe("m_sess_1")
      })
    })

    describe("#when getSession is called with missing id", () => {
      it("#then returns null", () => {
        const session = reader.getSession("sess_missing")
        expect(session).toBeNull()
      })
    })
  })

  describe("#given session summaries in fixture DB", () => {
    describe("#when getSessionSummary is called with known session", () => {
      it("#then returns the summary", () => {
        const summary = reader.getSessionSummary("m_sess_1")
        expect(summary).toBeDefined()
        expect(summary?.learned).toContain("structured summary fields")
        expect(summary?.notes).toContain("memory architecture")
      })
    })
  })

  describe("#given promotion candidate observations", () => {
    describe("#when getPromotionCandidates is called with threshold", () => {
      it("#then returns only decision and discovery types above threshold", () => {
        const candidates = reader.getPromotionCandidates({
          min_discovery_tokens: 200,
        })
        expect(candidates.length).toBeGreaterThan(0)
        expect(
          candidates.every((c) => ["decision", "discovery"].includes(c.type)),
        ).toBe(true)
        expect(
          candidates.every((c) => (c.discovery_tokens ?? 0) >= 200),
        ).toBe(true)
      })
    })

    describe("#when getPromotionCandidates is called with project filter", () => {
      it("#then returns only rows for that project", () => {
        const candidates = reader.getPromotionCandidates({
          min_discovery_tokens: 100,
          project: "other-project",
        })
        expect(candidates.length).toBe(1)
        expect(candidates[0].project).toBe("other-project")
      })
    })
  })

  describe("#given failed pending_messages", () => {
    describe("#when getLostWrites is called with known session", () => {
      it("#then returns only failed messages for the session", () => {
        const lost = reader.getLostWrites("sess_abc")
        expect(lost.length).toBe(1)
        expect(lost[0].status).toBe("failed")
        expect(lost[0].created_at).toBe("2026-04-01 09:30:00")
      })
    })

    describe("#when getLostWrites is called with unknown session", () => {
      it("#then returns empty array", () => {
        const lost = reader.getLostWrites("sess_none")
        expect(lost.length).toBe(0)
      })
    })
  })
})
