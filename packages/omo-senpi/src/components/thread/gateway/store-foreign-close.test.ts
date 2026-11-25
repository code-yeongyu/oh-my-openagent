import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, unlinkSync } from "node:fs"

import { gatewayDatabasePath } from "./paths"
import type { GatewayStore } from "./store"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

const alpha = {
  name: "alpha",
  moduleUrl: new URL("./testing/store-extension.mjs", import.meta.url).href,
  migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]],
}

/**
 * A short-lived client in another process, as in the incident: python3's stdlib sqlite3 (the system SQLite,
 * default unix VFS, no pragmas) runs `sql`, commits, prints `query`'s ids and closes. Bun's own SQLite (3.54)
 * does not unlink the WAL files in this lock state while 3.45 does, so a bun child would not reproduce it.
 */
async function foreignClient(db: string, sql: string, query?: string): Promise<string> {
  const script = `import json, os, sqlite3
c = sqlite3.connect(os.environ["FOREIGN_DB"])
c.executescript(os.environ["FOREIGN_SQL"])
c.commit()
if os.environ["FOREIGN_QUERY"]:
    print(json.dumps([{"id": row[0]} for row in c.execute(os.environ["FOREIGN_QUERY"])], separators=(",", ":")))
c.close()`
  const child = Bun.spawn(["python3", "-c", script], {
    env: { ...process.env, FOREIGN_DB: db, FOREIGN_SQL: sql, FOREIGN_QUERY: query ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`foreign client exited ${code}: ${err}`)
  return out.trim()
}

async function put(store: GatewayStore, id: number, value: string): Promise<void> {
  expect(await store.extensionCall("alpha", "put", { name: "alpha", id, value })).toEqual({
    kind: "ok",
    value: { value },
  })
}

// POSIX advisory locks and unlinking an open file: neither exists on Windows, where the store cannot lose its lock this way.
describe.skipIf(process.platform === "win32")("a foreign SQLite client beside a live store", () => {
  // The 2026-11-21 incident: a foreign process committed to the live store and, on close, believed it was the
  // last connection, checkpointed and deleted -wal and -shm under every running omo process.
  test("#given two stores open in one process #when a foreign process commits and closes #then the WAL files survive and later store writes stay visible to other processes", async () => {
    const h = (harness = createGatewayHarness())
    const db = gatewayDatabasePath(h.agentDir)
    const first = h.store()
    expect(await first.registerStoreExtension(alpha)).toEqual({ kind: "ok", value: { version: 1 } })
    await put(first, 1, "before")
    const second = h.store()
    expect(await second.journalMode()).toBe("wal")

    await foreignClient(db, "CREATE TABLE IF NOT EXISTS foreign_probe (x); INSERT INTO foreign_probe VALUES (1)")

    expect({ wal: existsSync(`${db}-wal`), shm: existsSync(`${db}-shm`) }).toEqual({ wal: true, shm: true })
    await put(first, 2, "after")
    expect(await foreignClient(db, "SELECT 1", "SELECT id FROM alpha_items ORDER BY id")).toBe(
      JSON.stringify([{ id: 1 }, { id: 2 }]),
    )
  })

  // Whatever removes the WAL files under a live store, its next call must not write into the unlinked WAL,
  // where the write would be lost to every other process: it reopens its connection and runs the call there.
  test("#given a live store whose -wal and -shm were removed #when it writes #then it reopens and the write reaches the database other processes read", async () => {
    const h = (harness = createGatewayHarness())
    const db = gatewayDatabasePath(h.agentDir)
    const store = h.store()
    expect(await store.registerStoreExtension(alpha)).toEqual({ kind: "ok", value: { version: 1 } })
    await put(store, 1, "before")
    await foreignClient(db, "PRAGMA wal_checkpoint(TRUNCATE)")
    unlinkSync(`${db}-wal`)
    unlinkSync(`${db}-shm`)

    await put(store, 2, "after")

    expect(await foreignClient(db, "SELECT 1", "SELECT id FROM alpha_items ORDER BY id")).toBe(
      JSON.stringify([{ id: 1 }, { id: 2 }]),
    )
  })
})
