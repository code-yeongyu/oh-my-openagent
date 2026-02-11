import { Database } from "bun:sqlite"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import {
  callMcbTool,
  createDefaultArgs,
  createMcbTestClient,
  parseMcbToolResponse,
  type McbTestClient,
} from "./mcb-client-helper"
import { waitForIndexReady } from "./mcb-roundtrip-helpers"

const mcbAvailable = Bun.which("mcb") !== null
const configPath = resolve(import.meta.dir, "test-mcb.toml")
const dbPath = `/tmp/mcb-e2e-index-${Date.now()}.db`

describe.skipIf(!mcbAvailable)("mcb index roundtrip with DB verification", () => {
  let testClient: McbTestClient
  let tempDir = ""

  beforeAll(async () => {
    testClient = await createMcbTestClient(15_000, configPath, {
      MCP__AUTH__USER_DB_PATH: dbPath,
    })
    tempDir = mkdtempSync(join(tmpdir(), "mcb-e2e-index-"))
    writeFileSync(
      join(tempDir, "calculator.ts"),
      "export function calculateTotalRoundtripMarker(items: number[]): number { return items.reduce((sum, item) => sum + item, 0) }\n",
    )
  })

  afterAll(async () => {
    await testClient.close()
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    for (const ext of ["", "-wal", "-shm"]) rmSync(dbPath + ext, { force: true })
  })

  //#given a temp directory with a known .ts file indexed via MCP
  //#when the index operation completes and we query SQLite directly
  //#then collections and file_hashes tables should contain persisted rows
  test("index start persists to collections and file_hashes tables", async () => {
    const collection = `e2e-index-${Date.now()}`
    const startResult = await callMcbTool(testClient.client, "index", {
      ...createDefaultArgs("index"),
      action: "start",
      path: tempDir,
      collection,
      extensions: ["ts"],
    })
    expect(startResult.isError).not.toBe(true)

    await waitForIndexReady(testClient.client, collection, {
      maxWaitMs: 30_000,
      intervalMs: 500,
      minIdleReadyMs: 1_000,
    })

    expect(existsSync(dbPath)).toBe(true)
    const db = new Database(dbPath, { readonly: true })
    try {
      const hasCollections = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collections'").get()
      expect(hasCollections).toBeTruthy()
      const collections = db.query("SELECT * FROM collections WHERE name = ?").all(collection)
      expect(collections.length).toBeGreaterThan(0)

      const hasFileHashes = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_hashes'").get()
      expect(hasFileHashes).toBeTruthy()
      const hashes = db.query("SELECT * FROM file_hashes WHERE collection = ?").all(collection) as Record<string, unknown>[]
      expect(hashes.length).toBeGreaterThan(0)
      const paths = hashes.map((h) => String(h.file_path ?? ""))
      expect(paths.some((p) => p.includes("calculator.ts"))).toBe(true)
    } finally {
      db.close()
    }
  }, 45_000)

  //#given an indexed collection and a code search query
  //#when search returns results but DB has 0 file_hashes rows
  //#then this documents MCB doing filesystem search instead of vector search
  test("search code cross-references with DB state", async () => {
    const collection = `e2e-search-${Date.now()}`
    await callMcbTool(testClient.client, "index", {
      ...createDefaultArgs("index"),
      action: "start",
      path: tempDir,
      collection,
      extensions: ["ts"],
    })
    await waitForIndexReady(testClient.client, collection, {
      maxWaitMs: 30_000,
      intervalMs: 500,
      minIdleReadyMs: 1_000,
    })

    const searchResult = await callMcbTool(testClient.client, "search", {
      ...createDefaultArgs("search"),
      resource: "code",
      query: "calculateTotalRoundtripMarker",
      collection,
    })
    const payload = JSON.stringify(parseMcbToolResponse(searchResult))
    const foundViaSearch = payload.includes("calculateTotalRoundtripMarker")

    const db = new Database(dbPath, { readonly: true })
    try {
      const hasFileHashes = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_hashes'").get()
      expect(hasFileHashes).toBeTruthy()
      const dbRowCount = (db.query("SELECT COUNT(*) as cnt FROM file_hashes WHERE collection = ?").get(collection) as Record<string, unknown>)?.cnt ?? 0
      expect(Number(dbRowCount)).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  }, 45_000)
})
