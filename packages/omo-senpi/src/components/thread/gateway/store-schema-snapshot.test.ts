import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GATEWAY_MIGRATIONS } from "./schema"
import { Sql, type SqliteConnection } from "./sql"
import { inCheckedSnapshot, listDeliveries, migrate, type StoreContext, transaction, write } from "./store-ops"
import { settled } from "./testing/settled"

// Every store op checks the schema and reads its data in one SQLite snapshot, and every write checks again under its
// write lock (#14622 review M5, M7). Each case runs on a real WAL file with a second connection standing in for another
// process, which commits at the exact statement the case names.

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const INCOMPATIBLE = `DELETE FROM gateway_meta WHERE key = 'reader_floor'; PRAGMA user_version = ${GATEWAY_MIGRATIONS.length + 1}`

async function fileStore() {
  const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "omo-gateway-snapshot-")))
  const path = join(agentDir, "gateway.sqlite")
  const db = new Database(path)
  db.exec("PRAGMA journal_mode = WAL")
  const before: { all?: (sql: string) => void; exec?: (sql: string) => void } = {}
  class InterleavedSql extends Sql {
    override all(...args: Parameters<Sql["all"]>): ReturnType<Sql["all"]> {
      before.all?.(args[1])
      return super.all(...args)
    }
    override exec(sql: string): void {
      before.exec?.(sql)
      super.exec(sql)
    }
  }
  const connection: SqliteConnection = {
    exec: (sql) => db.exec(sql),
    function: (name, options, fn) => db.function(name, options, fn as never),
    setAuthorizer: () => {
      throw new Error("no authorizer here")
    },
    close: () => db.close(),
  }
  const ctx = {
    sql: new InterleavedSql(connection),
    config: { agent_dir: agentDir, test_hooks: {}, busy_timeout_ms: 1_000, lock_wait_max_ms: 5_000 },
    stats: { writes: 0, marker_unlinks: 0, transactions: 0 },
    emit: () => undefined,
    hook: async () => undefined,
    delay: async () => undefined,
  } as unknown as StoreContext
  cleanups.push(() => {
    db.close()
    rmSync(agentDir, { recursive: true, force: true })
  })
  await migrate(ctx)
  const other = (sql: string) => {
    const connection = new Database(path)
    try {
      connection.exec(sql)
    } finally {
      connection.close()
    }
  }
  const meta = (key: string) => db.query("SELECT value FROM gateway_meta WHERE key = ?").get(key)
  return { ctx, before, other, meta }
}

const once = (run: () => void) => {
  let done = false
  return () => {
    if (done) return
    done = true
    run()
  }
}

test("#given an op past its schema check #when another process commits an incompatible migration before the op reads #then the op reads the schema it checked and the next op is refused typed", async () => {
  const { ctx, before, other } = await fileStore()
  // The migration renames a column the read selects: a read outside the checked snapshot fails untyped.
  const migrateUnderTheRead = once(() =>
    other(`ALTER TABLE deliveries RENAME COLUMN body TO body_next; ${INCOMPATIBLE}`),
  )
  before.all = (sql) => {
    if (sql.includes("FROM deliveries")) migrateUnderTheRead()
  }

  expect(await settled(inCheckedSnapshot(ctx, () => listDeliveries(ctx, {})))).toEqual({ value: [] })
  expect((await settled(inCheckedSnapshot(ctx, () => listDeliveries(ctx, {})))).error).toMatchObject({
    code: "gateway_schema_too_new",
  })
})

test("#given an op that read in its snapshot #when another process commits an incompatible migration before the op takes its write lock #then the write is refused typed under the lock and writes nothing", async () => {
  const { ctx, before, other, meta } = await fileStore()
  const migrateBeforeTheLock = once(() => other(INCOMPATIBLE))
  before.exec = (sql) => {
    if (sql === "BEGIN IMMEDIATE") migrateBeforeTheLock()
  }

  const result = await settled(
    inCheckedSnapshot(ctx, async () => {
      listDeliveries(ctx, {})
      return await transaction(ctx, "probe", () =>
        write(ctx, "INSERT INTO gateway_meta (key, value) VALUES ('probe', 'written')"),
      )
    }),
  )
  expect(result.error).toMatchObject({ code: "gateway_schema_too_new" })
  expect(meta("probe")).toBeNull()
})

test("#given an op that throws inside its snapshot #then the snapshot ends with it and the next op runs", async () => {
  const { ctx } = await fileStore()
  const failed = await settled(
    inCheckedSnapshot(ctx, () => {
      throw new Error("op failed")
    }),
  )
  expect(failed.error?.message).toBe("op failed")
  expect(await settled(inCheckedSnapshot(ctx, () => listDeliveries(ctx, {})))).toEqual({ value: [] })
})

test("#given an op whose write transaction rolls back #then nothing is written and the next op runs", async () => {
  const { ctx, meta } = await fileStore()
  const failed = await settled(
    inCheckedSnapshot(ctx, () =>
      transaction(ctx, "probe", () => {
        write(ctx, "INSERT INTO gateway_meta (key, value) VALUES ('probe', 'written')")
        throw new Error("rolled back")
      }),
    ),
  )
  expect(failed.error?.message).toBe("rolled back")
  expect(meta("probe")).toBeNull()
  expect(await settled(inCheckedSnapshot(ctx, () => listDeliveries(ctx, {})))).toEqual({ value: [] })
})

test("#given an op's snapshot older than another process's commit #when the op writes outside a transaction #then the write leaves the snapshot and lands (no stale-snapshot busy error)", async () => {
  const { ctx, other, meta } = await fileStore()
  const result = await settled(
    inCheckedSnapshot(ctx, () => {
      listDeliveries(ctx, {})
      other("INSERT INTO gateway_meta (key, value) VALUES ('other', 'first')")
      return write(ctx, "INSERT INTO gateway_meta (key, value) VALUES ('mine', 'second')")
    }),
  )
  expect(result).toEqual({ value: 1 })
  expect(meta("other")).toEqual({ value: "first" })
  expect(meta("mine")).toEqual({ value: "second" })
})
