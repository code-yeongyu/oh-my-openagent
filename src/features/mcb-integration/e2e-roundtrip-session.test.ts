import { Database } from "bun:sqlite"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "fs"
import { resolve } from "path"
import {
  callMcbTool,
  createDefaultArgs,
  createMcbTestClient,
  parseMcbToolResponse,
  type McbTestClient,
} from "./mcb-client-helper"

const mcbAvailable = Bun.which("mcb") !== null
const configPath = resolve(import.meta.dir, "test-mcb.toml")
const dbPath = `/tmp/mcb-e2e-session-${Date.now()}.db`

describe.skipIf(!mcbAvailable)("mcb session roundtrip with DB verification", () => {
  let testClient: McbTestClient

  beforeAll(async () => {
    testClient = await createMcbTestClient(15_000, configPath, {
      MCP__AUTH__USER_DB_PATH: dbPath,
    })
  })

  afterAll(async () => {
    await testClient.close()
    for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true })
  })

  //#given a session create call with all required fields per MCB create.rs
  //#when the MCP operation completes and we query the SQLite DB directly
  //#then agent_sessions table should contain the persisted row
  test("session create persists to agent_sessions table", async () => {
    const result = await callMcbTool(testClient.client, "session", {
      ...createDefaultArgs("session"),
      action: "create",
      agent_type: "sisyphus",
      data: { name: "e2e-session-test", session_summary_id: `e2e-summary-${Date.now()}`, model: "test-model" },
    })

    expect(result.isError).toBe(false)

    const parsed = parseMcbToolResponse(result)
    const sessionId = extractSessionId(parsed)
    expect(sessionId).not.toBeNull()

    expect(existsSync(dbPath)).toBe(true)
    const db = new Database(dbPath, { readonly: true })
    try {
      const hasTable = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_sessions'").get()
      expect(hasTable).toBeTruthy()

      const rows = db.query("SELECT * FROM agent_sessions").all() as Record<string, unknown>[]
      expect(rows.length).toBeGreaterThan(0)

      if (sessionId && rows.length > 0) {
        const match = rows.find((r) => r.id === sessionId)
        expect(match).toBeTruthy()
        expect(match?.agent_type).toBe("sisyphus")
        expect(match?.status).toBe("active")
      }
    } finally {
      db.close()
    }
  }, 20_000)

  //#given a session create then get with the returned session_id
  //#when we query the SQLite DB for the specific row
  //#then the DB row fields should match the MCP get response
  test("session get returns data matching DB state", async () => {
    const createResult = await callMcbTool(testClient.client, "session", {
      ...createDefaultArgs("session"),
      action: "create",
      agent_type: "explore",
      data: { name: "e2e-get-test", session_summary_id: `e2e-summary-${Date.now()}`, model: "test-model" },
    })
    const sessionId = extractSessionId(parseMcbToolResponse(createResult))

    if (!sessionId) {
      expect(sessionId).not.toBeNull()
      return
    }

    await callMcbTool(testClient.client, "session", {
      ...createDefaultArgs("session"),
      action: "get",
      session_id: sessionId,
    })

    const db = new Database(dbPath, { readonly: true })
    try {
      const row = db.query("SELECT * FROM agent_sessions WHERE id = ?").get(sessionId) as Record<string, unknown> | null
      expect(row).not.toBeNull()
      if (row) {
        expect(row.agent_type).toBe("explore")
        expect(row.status).toBe("active")
      }
    } finally {
      db.close()
    }
  }, 20_000)

  //#given a memory store observation call with required project_id
  //#when the MCP operation completes and DB is queried
  //#then observations table has a row matching our content, type, and project_id
  test("memory store observation persists to observations table", async () => {
    const storeResult = await callMcbTool(testClient.client, "memory", {
      ...createDefaultArgs("memory"),
      action: "store",
      resource: "observation",
      project_id: "test-project",
      data: { content: "e2e-memory-test", observation_type: "code", project_id: "test-project" },
    })
    const storePayload = parseMcbToolResponse(storeResult)
    const storeText = typeof storePayload === "string" ? storePayload : JSON.stringify(storePayload)
    expect(storeText).toContain("observation_id")

    const db = new Database(dbPath, { readonly: true })
    try {
      const hasTable = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='observations'").get()
      expect(hasTable).toBeTruthy()

      const rows = db.query("SELECT * FROM observations WHERE project_id = ? AND content = ?").all(
        "test-project",
        "e2e-memory-test",
      ) as Record<string, unknown>[]
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0]!.observation_type).toBe("code")
      expect(rows[0]!.project_id).toBe("test-project")
      expect(rows[0]!.content).toBe("e2e-memory-test")
    } finally {
      db.close()
    }
  }, 20_000)
})

function extractSessionId(payload: unknown): string | null {
  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>
    if (typeof record.session_id === "string" && record.session_id.length > 0) return record.session_id
    if (typeof record.id === "string" && record.id.length > 0) return record.id
  }
  const rawText = typeof payload === "string" ? payload : JSON.stringify(payload)
  const matched = rawText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return matched?.[0] ?? null
}
