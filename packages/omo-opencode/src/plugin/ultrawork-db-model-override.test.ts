import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as dataPathModule from "../shared/data-path"
import * as sharedModule from "../shared"

let scheduleDeferredModelOverride: (typeof import("./ultrawork-db-model-override"))["scheduleDeferredModelOverride"]

async function importFreshUltraworkDbModelOverrideModule(): Promise<typeof import("./ultrawork-db-model-override")> {
  return import(`./ultrawork-db-model-override?test=${Date.now()}-${Math.random()}`)
}

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
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function settleDeferredModelOverrideWork(): Promise<void> {
  await flushMicrotasks(12)
  await flushWithTimeout()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

describe("scheduleDeferredModelOverride", () => {
  let tempDir: string
  let dbPath: string
  let logSpy: ReturnType<typeof spyOn>
  let getDataDirSpy: ReturnType<typeof spyOn>

  beforeEach(async () => {
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

    getDataDirSpy = spyOn(dataPathModule, "getDataDir")
    getDataDirSpy.mockReturnValue(tempDir)
    logSpy = spyOn(sharedModule, "log")
    logSpy.mockImplementation(() => {})
    ;({ scheduleDeferredModelOverride } = await importFreshUltraworkDbModelOverrideModule())
  })

  afterEach(async () => {
    await settleDeferredModelOverrideWork()
    getDataDirSpy?.mockRestore()
    logSpy?.mockRestore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function insertMessage(id: string, model: { providerID: string; modelID: string }) {
    const db = new Database(dbPath)
    const stmt = db.prepare(
      `INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)`,
    )
    try {
      stmt.run(id, "ses_test", JSON.stringify({ model }))
    } finally {
      stmt.finalize()
      db.close()
    }
  }

  function readMessageModel(id: string): { providerID: string; modelID: string } | null {
    const db = new Database(dbPath)
    const stmt = db.query(`SELECT data FROM message WHERE id = ?`)
    let row: { data: string } | null
    try {
      row = stmt.get(id) as { data: string } | null
    } finally {
      stmt.finalize()
      db.close()
    }
    if (!row) return null
    const parsed = JSON.parse(row.data)
    return parsed.model ?? null
  }

  function readMessageField(id: string, field: string): unknown {
    const db = new Database(dbPath)
    const stmt = db.query(`SELECT data FROM message WHERE id = ?`)
    let row: { data: string } | null
    try {
      row = stmt.get(id) as { data: string } | null
    } finally {
      stmt.finalize()
      db.close()
    }
    if (!row) return null
    return JSON.parse(row.data)[field] ?? null
  }

  test("should update model in DB after microtask flushes", async () => {
    //#given
    insertMessage("msg_001", { providerID: "anthropic", modelID: "claude-sonnet-4-6" })

    //#when
    await scheduleDeferredModelOverride(
      "msg_001",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )

    //#then
    const model = readMessageModel("msg_001")
    expect(model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
  })

  test("should update variant and thinking fields when variant provided", async () => {
    //#given
    insertMessage("msg_002", { providerID: "anthropic", modelID: "claude-sonnet-4-6" })

    //#when
    await scheduleDeferredModelOverride(
      "msg_002",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
      "max",
    )

    //#then
    expect(readMessageField("msg_002", "variant")).toBe("max")
    expect(readMessageField("msg_002", "thinking")).toBe("max")
  })

  test("should fall back to setTimeout when message never appears", async () => {
    //#given no message inserted

    //#when
    await scheduleDeferredModelOverride(
      "msg_nonexistent",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )

    //#then
    const fallbackFailureCall = logSpy.mock.calls.find((call: readonly unknown[]) => {
      const message = call[0]
      const metadata = call[1]
      return (
        typeof message === "string"
        && message.includes("setTimeout fallback failed")
        && isRecord(metadata)
        && metadata.messageId === "msg_nonexistent"
      )
    })
    expect(fallbackFailureCall).toBeDefined()
  })

  test("should log when microtask retries are exhausted before setTimeout fallback", async () => {
    //#given no message inserted

    //#when
    await scheduleDeferredModelOverride(
      "msg_retry_exhausted",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )

    //#then
    const retryExhaustedCall = logSpy.mock.calls.find((call: readonly unknown[]) => {
      const message = call[0]
      const metadata = call[1]
      return (
        message === "[ultrawork-db-override] Exhausted microtask retries, falling back to setTimeout"
        && isRecord(metadata)
        && metadata.messageId === "msg_retry_exhausted"
        && metadata.attempt === 10
      )
    })
    expect(retryExhaustedCall).toBeDefined()
  })

  test("should not update variant fields when variant is undefined", async () => {
    //#given
    insertMessage("msg_003", { providerID: "anthropic", modelID: "claude-sonnet-4-6" })

    //#when
    await scheduleDeferredModelOverride(
      "msg_003",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )

    //#then
    const model = readMessageModel("msg_003")
    expect(model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
    expect(readMessageField("msg_003", "variant")).toBeNull()
    expect(readMessageField("msg_003", "thinking")).toBeNull()
  })

  test("should not crash when DB path does not exist", async () => {
    //#given
    getDataDirSpy.mockReturnValue("/nonexistent/path/that/does/not/exist")

    //#when
    await scheduleDeferredModelOverride(
      "msg_004",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )

    //#then
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("DB not found"),
    )
  })

  test("should log a DB failure when DB file exists but is corrupted", async () => {
    //#given
    const { chmodSync, writeFileSync } = await import("node:fs")
    const corruptedDbPath = join(tempDir, "opencode", "opencode.db")
    writeFileSync(corruptedDbPath, "this is not a valid sqlite database file")
    chmodSync(corruptedDbPath, 0o000)

    //#when
    await scheduleDeferredModelOverride(
      "msg_corrupt",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )

    //#then
    const failureCall = logSpy.mock.calls.find((call: readonly unknown[]) => {
      const message = call[0]
      const metadata = call[1]
      return (
        typeof message === "string"
        && (
          message.includes("Failed to open DB")
          || message.includes("Deferred DB update failed with error")
        )
        && isRecord(metadata)
        && metadata.messageId === "msg_corrupt"
      )
    })

    expect(failureCall).toBeDefined()
  })
})
