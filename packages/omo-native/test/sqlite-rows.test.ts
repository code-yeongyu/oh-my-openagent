import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readRow, readRows } from "../bin/lib/sqlite-rows.js"

const SQLITE_AVAILABLE = await (async () => {
  try { await import("node:sqlite"); return true } catch { return false }
})()

async function loadDatabaseSync() {
  const sqlite = await import("node:sqlite")
  return sqlite.DatabaseSync
}

/** Open handles on `needle` in this process. Linux only; other hosts return undefined. */
function openHandlesOn(needle: string): number | undefined {
  if (process.platform !== "linux") return undefined
  return readdirSync("/proc/self/fd")
    .map((fd) => { try { return readlinkSync(join("/proc/self/fd", fd)) } catch { return "" } })
    .filter((target) => target.includes(needle)).length
}

async function seededDatabase(): Promise<{ root: string; path: string }> {
  const root = mkdtempSync(join(tmpdir(), "omo-sqlite-rows-"))
  const path = join(root, "agent.db")
  const DatabaseSync = await loadDatabaseSync()
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE auth_schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
    INSERT INTO auth_schema_version VALUES (1, 7);
    CREATE TABLE auth_credentials (
      id INTEGER PRIMARY KEY, provider TEXT NOT NULL, credential_type TEXT NOT NULL,
      data TEXT NOT NULL, disabled_cause TEXT DEFAULT NULL
    );
    INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause) VALUES
      ('omp-api', 'api_key', '{"key":"SECRET"}', NULL),
      ('omp-disabled', 'oauth', '{}', 'expired');
  `)
  db.close()
  return { root, path }
}

describe("sqlite-rows", () => {
  test.skipIf(!SQLITE_AVAILABLE)("#given a seeded store #when rows are read #then every projected column comes back keyed by name, in order", async () => {
    const { root, path } = await seededDatabase()
    try {
      const DatabaseSync = await loadDatabaseSync()
      const db = new DatabaseSync(path, { readOnly: true })
      const version = readRow(db, ["version"], "SELECT version FROM auth_schema_version")
      const rows = readRows(db, ["provider", "credential_type", "disabled_cause"],
        "SELECT provider, credential_type, disabled_cause FROM auth_credentials ORDER BY id ASC")
      db.close()
      expect(version).toEqual({ version: 7 })
      expect(rows).toEqual([
        { provider: "omp-api", credential_type: "api_key", disabled_cause: null },
        { provider: "omp-disabled", credential_type: "oauth", disabled_cause: "expired" },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test.skipIf(!SQLITE_AVAILABLE)("#given rows were read #when the database is closed #then no file handle survives close()", async () => {
    // The defect this module exists to avoid: a prepared statement keeps the SQLite file handle
    // alive past close(). Reading through exec() + a sink function must leave nothing behind.
    const { root, path } = await seededDatabase()
    try {
      const DatabaseSync = await loadDatabaseSync()
      const db = new DatabaseSync(path, { readOnly: true })
      readRow(db, ["version"], "SELECT version FROM auth_schema_version")
      readRows(db, ["provider"], "SELECT provider FROM auth_credentials")
      db.close()
      const handles = openHandlesOn("agent.db")
      if (handles !== undefined) expect(handles).toBe(0)
      // Every host: the directory must be removable right now. On Windows a retained handle
      // makes this throw EBUSY, which is exactly the teardown failure seen in CI.
      rmSync(root, { recursive: true, force: true })
      expect(existsSync(root)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test.skipIf(!SQLITE_AVAILABLE)("#given an empty result #when rows are read #then an empty array and undefined row come back", async () => {
    const { root, path } = await seededDatabase()
    try {
      const DatabaseSync = await loadDatabaseSync()
      const db = new DatabaseSync(path, { readOnly: true })
      const none = readRows(db, ["provider"], "SELECT provider FROM auth_credentials WHERE 1 = 0")
      const first = readRow(db, ["provider"], "SELECT provider FROM auth_credentials WHERE 1 = 0")
      db.close()
      expect(none).toEqual([])
      expect(first).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
