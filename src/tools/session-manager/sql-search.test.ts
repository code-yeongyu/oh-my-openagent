import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { unlinkSync, existsSync } from "node:fs"
import { searchSessionsSQL, getDBPath } from "./sql-search"
import type { SearchResult } from "./types"

let testDB: Database
let testDBPath: string

function createTestDB(): { db: Database; path: string } {
  const path = join(tmpdir(), `omo-test-sql-search-${Date.now()}.db`)
  const db = new Database(path)
  db.run("PRAGMA journal_mode=WAL")
  db.run("PRAGMA foreign_keys=ON")

  db.run(`
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES session(id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES message(id)
    )
  `)

  return { db, path }
}

function seedTestData(db: Database) {
  const now = Date.now()

  // Session 1: "Deploy pipeline discussion"
  db.run(
    `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ["ses_alpha", "proj_1", "alpha-slug", "/workspace/proj", "Deploy pipeline discussion", "1.0", now - 100000, now - 50000]
  )

  // Session 2: "Bug triage"
  db.run(
    `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ["ses_beta", "proj_2", "beta-slug", "/workspace/bugs", "Bug triage session", "1.0", now - 80000, now - 30000]
  )

  // Messages for session 1
  db.run(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`,
    ["msg_a1", "ses_alpha", now - 90000, now - 90000, JSON.stringify({ role: "user", model: { providerID: "test", modelID: "gpt-4" } })]
  )
  db.run(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`,
    ["msg_a2", "ses_alpha", now - 85000, now - 85000, JSON.stringify({ role: "assistant", agent: "build" })]
  )

  // Messages for session 2
  db.run(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`,
    ["msg_b1", "ses_beta", now - 70000, now - 70000, JSON.stringify({ role: "user", agent: "oracle" })]
  )

  // Parts for ses_alpha messages
  db.run(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["prt_a1", "msg_a1", "ses_alpha", now - 90000, now - 90000, JSON.stringify({ type: "text", text: "Let's discuss the Kubernetes deployment pipeline" })]
  )
  db.run(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["prt_a2", "msg_a2", "ses_alpha", now - 85000, now - 85000, JSON.stringify({ type: "text", text: "I'll configure the CI/CD pipeline now" })]
  )
  db.run(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["prt_a3", "msg_a2", "ses_alpha", now - 84000, now - 84000, JSON.stringify({ type: "thinking", thinking: "Need to check Dockerfile for multistage build" })]
  )

  // Parts for ses_beta messages
  db.run(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["prt_b1", "msg_b1", "ses_beta", now - 70000, now - 70000, JSON.stringify({ type: "text", text: "Found a critical SQL injection bug in the search API" })]
  )
  db.run(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["prt_b2", "msg_b1", "ses_beta", now - 69000, now - 69000, JSON.stringify({ type: "tool_use", tool: "bash", input: { command: "grep -r 'SELECT.*FROM' src/" } })]
  )
  db.run(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["prt_b3", "msg_b1", "ses_beta", now - 68000, now - 68000, JSON.stringify({ type: "text", text: "Cache hit rate is 50% with 4x speedup and 42_days retention" })]
  )
}

beforeAll(() => {
  const created = createTestDB()
  testDB = created.db
  testDBPath = created.path
  seedTestData(testDB)
})

afterAll(() => {
  testDB.close()
  if (existsSync(testDBPath)) {
    unlinkSync(testDBPath)
  }
})

describe("sql-search", () => {
  describe("getDBPath", () => {
    test("returns default path from XDG_DATA_HOME", () => {
      // #when
      const result = getDBPath()

      // #then
      expect(result).toContain("opencode.db")
      expect(result).toContain(".local/share/opencode")
    })
  })

  describe("searchSessionsSQL", () => {
    test("finds exact match in message part text", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "Kubernetes", limit: 10 })

      // #then
      expect(results.length).toBeGreaterThanOrEqual(1)
      const kubernetesResult = results.find((r) => r.excerpt.includes("Kubernetes"))
      expect(kubernetesResult).toBeDefined()
      expect(kubernetesResult!.session_id).toBe("ses_alpha")
      expect(kubernetesResult!.source).toBe("sql")
    })

    test("finds match in thinking parts (not just text)", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "multistage build", limit: 10 })

      // #then
      expect(results.length).toBeGreaterThanOrEqual(1)
      const thinkingResult = results.find((r) => r.excerpt.includes("multistage"))
      expect(thinkingResult).toBeDefined()
      expect(thinkingResult!.match_type).toContain("text")
    })

    test("finds match in data column (not part)", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "gpt-4", limit: 10 })

      // #then
      expect(results.length).toBeGreaterThanOrEqual(1)
      const dataResult = results.find((r) => r.session_id === "ses_alpha" && r.match_type.includes("data"))
      expect(dataResult).toBeDefined()
    })

    test("is case insensitive by default", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "kubernetes", limit: 10 })

      // #then
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.some((r) => r.excerpt.includes("Kubernetes"))).toBe(true)
    })

    test("is case sensitive when requested", () => {
      // #when
      const resultsUpper = searchSessionsSQL(testDB, { query: "Kubernetes", caseSensitive: true, limit: 10 })
      const resultsLower = searchSessionsSQL(testDB, { query: "kubernetes", caseSensitive: true, limit: 10 })

      // #then
      expect(resultsUpper.length).toBeGreaterThanOrEqual(1)
      expect(resultsLower.length).toBe(0)
    })

    test("filters by session_id", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "pipeline", sessionID: "ses_alpha", limit: 10 })

      // #then
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.every((r) => r.session_id === "ses_alpha")).toBe(true)
      expect(results.some((r) => r.session_id === "ses_beta")).toBe(false)
    })

    test("respects limit parameter", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "the", limit: 1 })

      // #then
      expect(results.length).toBe(1)
    })

    test("returns empty array for no matches", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "zzzzz_no_match_xyzzy", limit: 10 })

      // #then
      expect(results).toEqual([])
    })

    test("includes title in results", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "Kubernetes", limit: 10 })

      // #then
      const kubernetesResult = results.find((r) => r.session_id === "ses_alpha")
      expect(kubernetesResult).toBeDefined()
      expect(kubernetesResult!.title).toBe("Deploy pipeline discussion")
    })

    test("includes score field in results", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "Kubernetes", limit: 10 })

      // #then
      expect(results.every((r) => typeof r.score === "number")).toBe(true)
    })

    test("has correct SearchResult shape", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "deploy", limit: 10 })

      // #then
      expect(results.length).toBeGreaterThanOrEqual(1)
      const r = results[0]
      expect(typeof r.session_id).toBe("string")
      expect(typeof r.message_id).toBe("string")
      expect(typeof r.role).toBe("string")
      expect(typeof r.excerpt).toBe("string")
      expect(typeof r.match_count).toBe("number")
      expect(r.match_count).toBeGreaterThan(0)
      expect(Array.isArray(r.match_type)).toBe(true)
      expect(typeof r.source).toBe("string")
      expect(typeof r.score).toBe("number")
    })

    test("deduplicates by message_id", () => {
      // #when - "deploy" appears in one session's title and part
      const results = searchSessionsSQL(testDB, { query: "deploy", limit: 20 })

      // #then
      const sesAlphaMessages = results.filter((r) => r.session_id === "ses_alpha")
      const messageIDs = sesAlphaMessages.map((r) => r.message_id)
      const uniqueIDs = new Set(messageIDs)
      expect(messageIDs.length).toBe(uniqueIDs.size)
    })

    test("handles empty query gracefully", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "", limit: 10 })

      // #then
      expect(results).toEqual([])
    })

    test("handles whitespace-only query", () => {
      // #when
      const results = searchSessionsSQL(testDB, { query: "   ", limit: 10 })

      // #then
      expect(results).toEqual([])
    })

    test("handles literal percent and underscore characters", () => {
      // #given - test data has "50%" and "42_days" in prt_b3

      // #when
      const percentResults = searchSessionsSQL(testDB, { query: "50%", limit: 10 })

      // #then
      expect(percentResults.length).toBeGreaterThanOrEqual(1)
      expect(percentResults.some((r) => r.excerpt.includes("50%"))).toBe(true)

      // #when
      const underscoreResults = searchSessionsSQL(testDB, { query: "42_days", limit: 10 })

      // #then
      expect(underscoreResults.length).toBeGreaterThanOrEqual(1)
      expect(underscoreResults.some((r) => r.excerpt.includes("42_days"))).toBe(true)
    })
  })
})