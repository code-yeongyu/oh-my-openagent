import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as dataPathModule from "../shared/data-path"
import * as sharedModule from "../shared"

function flushMicrotasks(depth: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let remaining = depth
    function step() {
      if (remaining <= 0) { resolve(); return }
      remaining--
      queueMicrotask(step)
    }
    queueMicrotask(step)
  })
}

function flushWithTimeout(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 10))
}

describe("scheduleDeferredModelOverride", () => {
  let tempDir: string
  let dbPath: string
  let logSpy: ReturnType<typeof spyOn>
  let getDataDirSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ultrawork-db-test-"))
    const opencodePath = join(tempDir, "opencode")
    mkdirSync(opencodePath, { recursive: true })
    dbPath = join(opencodePath, "opencode.db")

    const db = new Database(dbPath)
    db.run(`
      CREATE TABLE IF NOT EXISTS message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created TEXT NOT NULL DEFAULT (datetime('now')),
        time_updated TEXT NOT NULL DEFAULT (datetime('now')),
        data TEXT NOT NULL DEFAULT '{}'
      )
    `)
    db.close()

    getDataDirSpy = spyOn(dataPathModule, "getDataDir").mockReturnValue(tempDir)
    logSpy = spyOn(sharedModule, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    getDataDirSpy?.mockRestore()
    logSpy?.mockRestore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function insertMessage(id: string, model: { providerID: string; modelID: string }) {
    const db = new Database(dbPath)
    db.run(
      `INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)`,
      id,
      "ses_test",
      JSON.stringify({ model }),
    )
    db.close()
  }

  function readMessageModel(id: string): { providerID: string; modelID: string } | null {
    const db = new Database(dbPath)
    const row = db.query(`SELECT data FROM message WHERE id = ?`).get(id) as
      | { data: string }
      | null
    db.close()
    if (!row) return null
    const parsed = JSON.parse(row.data)
    return parsed.model ?? null
  }

  function readMessageField(id: string, field: string): unknown {
    const db = new Database(dbPath)
    const row = db.query(`SELECT data FROM message WHERE id = ?`).get(id) as
      | { data: string }
      | null
    db.close()
    if (!row) return null
    return JSON.parse(row.data)[field] ?? null
  }

  test("should update model in DB after microtask flushes", async () => {
    //#given
    insertMessage("msg_001", { providerID: "anthropic", modelID: "claude-sonnet-4-6" })

    //#when
    const { scheduleDeferredModelOverride } = await import("./ultrawork-db-model-override")
    scheduleDeferredModelOverride(
      "msg_001",
      { providerID: "anthropic", modelID: "claude-opus-4-6" },
    )
    await flushMicrotasks(5)

    //#then
    const model = readMessageModel("msg_001")
    expect(model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
  })

  test("should update variant and thinking fields when variant provided", async () => {
    //#given
    insertMessage("msg_002", { providerID: "anthropic", modelID: "claude-sonnet-4-6" })

    //#when
    const { scheduleDeferredModelOverride } = await import("./ultrawork-db-model-override")
    scheduleDeferredModelOverride(
      "msg_002",
      { providerID: "anthropic", modelID: "claude-opus-4-6" },
      "max",
    )
    await flushMicrotasks(5)

    //#then
    expect(readMessageField("msg_002", "variant")).toBe("max")
    expect(readMessageField("msg_002", "thinking")).toBe("max")
  })

  test("should fall back to setTimeout when message never appears", async () => {
    //#given — no message inserted

    //#when
    const { scheduleDeferredModelOverride } = await import("./ultrawork-db-model-override")
    scheduleDeferredModelOverride(
      "msg_nonexistent",
      { providerID: "anthropic", modelID: "claude-opus-4-6" },
    )
    await flushWithTimeout()

    //#then
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("setTimeout fallback failed"),
      expect.objectContaining({ messageId: "msg_nonexistent" }),
    )
  })

  test("should not update variant fields when variant is undefined", async () => {
    //#given
    insertMessage("msg_003", { providerID: "anthropic", modelID: "claude-sonnet-4-6" })

    //#when
    const { scheduleDeferredModelOverride } = await import("./ultrawork-db-model-override")
    scheduleDeferredModelOverride(
      "msg_003",
      { providerID: "anthropic", modelID: "claude-opus-4-6" },
    )
    await flushMicrotasks(5)

    //#then
    const model = readMessageModel("msg_003")
    expect(model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
    expect(readMessageField("msg_003", "variant")).toBeNull()
    expect(readMessageField("msg_003", "thinking")).toBeNull()
  })

  test("should not crash when DB path does not exist", async () => {
    //#given
    getDataDirSpy.mockReturnValue("/nonexistent/path/that/does/not/exist")

    //#when
    const { scheduleDeferredModelOverride } = await import("./ultrawork-db-model-override")
    scheduleDeferredModelOverride(
      "msg_004",
      { providerID: "anthropic", modelID: "claude-opus-4-6" },
    )
    await flushMicrotasks(5)

    //#then
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("DB not found"),
    )
  })

  test("should not crash when DB file exists but is corrupted", async () => {
    //#given
    const { chmodSync, writeFileSync } = await import("node:fs")
    const corruptedDbPath = join(tempDir, "opencode", "opencode.db")
    writeFileSync(corruptedDbPath, "this is not a valid sqlite database file")
    chmodSync(corruptedDbPath, 0o000)

    //#when
    const { scheduleDeferredModelOverride } = await import("./ultrawork-db-model-override")
    scheduleDeferredModelOverride(
      "msg_corrupt",
      { providerID: "anthropic", modelID: "claude-opus-4-6" },
    )
    await flushMicrotasks(5)

    //#then
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to open DB"),
      expect.objectContaining({ messageId: "msg_corrupt" }),
    )
  })
})
