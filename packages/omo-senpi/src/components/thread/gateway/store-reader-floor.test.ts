import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GatewayDeliverRequest } from "./engine"
import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS, gatewayReaderFloor } from "./schema"
import { Sql, type SqliteConnection } from "./sql"
import { migrate, type StoreContext } from "./store-ops"

const GATEWAY_READER_FLOOR_KEY = "reader_floor"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import { settled } from "./testing/settled"

/**
 * Storage contract of the reader floor (#14382): a binary that migrates the gateway store records the oldest schema whose
 * code may keep using it, and an older binary opens a newer store when it meets that floor instead of refusing every
 * thread operation. An install of a newer omo must not cut running sessions off.
 */
let harness: GatewayHarness | undefined
const cleanups: (() => void)[] = []
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function send(h: GatewayHarness, from: string, to: string, text: string): Promise<unknown> {
  const request: GatewayDeliverRequest = { sender: { kind: "session", durable_id: from }, target: to, text }
  return h.get(from).engine.deliver(request)
}

function kindOf(result: unknown): string {
  const r = result as { kind: string; delivery?: { kind: string }; error?: { code: string } }
  return r.kind === "ok" ? (r.delivery?.kind ?? "ok") : `error:${r.error?.code}`
}

/** What a newer binary leaves behind: the store at `version`, with the floor it recorded (none when `floor` is null). */
function migrateAhead(agentDir: string, version: number, floor: number | null): void {
  const db = new Database(gatewayDatabasePath(agentDir))
  try {
    db.exec(`PRAGMA user_version = ${version}`)
    if (floor === null) db.query("DELETE FROM gateway_meta WHERE key = ?").run(GATEWAY_READER_FLOOR_KEY)
    else
      db.query("INSERT OR REPLACE INTO gateway_meta (key, value) VALUES (?, ?)").run(
        GATEWAY_READER_FLOOR_KEY,
        String(floor),
      )
  } finally {
    db.close()
  }
}

test("#given this binary opens its store #then it records reader floor 14 (v15 and v16 keep v14 readers working)", async () => {
  const h = (harness = createGatewayHarness())
  await h.store().identity()
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT value FROM gateway_meta WHERE key = ?").get(GATEWAY_READER_FLOOR_KEY)).toEqual({
      value: "14",
    })
  } finally {
    db.close()
  }
})

test("#given a fresh store #when migrate commits each step #then every commit makes its version visible together with that version's reader floor", async () => {
  const db = new Database(":memory:")
  const committed: { version: number; floor: string | null }[] = []
  const visible = () => {
    const version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
    const meta = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'gateway_meta'").get() as {
      n: number
    }
    const row =
      Number(meta.n) === 0
        ? undefined
        : (db.query("SELECT value FROM gateway_meta WHERE key = ?").get(GATEWAY_READER_FLOOR_KEY) as
            { value: string } | undefined)
    return { version, floor: row?.value ?? null }
  }
  class CommitObservingSql extends Sql {
    override exec(sql: string): void {
      if (sql === "COMMIT") committed.push(visible())
      super.exec(sql)
    }
  }
  const connection: SqliteConnection = {
    exec: (sql) => db.exec(sql),
    function: (name, options, fn) => db.function(name, options, fn as never),
    setAuthorizer: () => {
      throw new Error("migrate never installs an authorizer")
    },
    close: () => db.close(),
  }
  const ctx = {
    sql: new CommitObservingSql(connection),
    config: { agent_dir: realpathSync(mkdtempSync(join(tmpdir(), "omo-gateway-commit-"))), test_hooks: {} },
    stats: { writes: 0, marker_unlinks: 0, transactions: 0 },
    emit: () => undefined,
    hook: async () => undefined,
    delay: async () => undefined,
  } as unknown as StoreContext
  cleanups.push(() => {
    db.close()
    rmSync(ctx.config.agent_dir, { recursive: true, force: true })
  })

  await migrate(ctx)

  expect(committed).toEqual(
    GATEWAY_MIGRATIONS.map((_, step) => ({ version: step + 1, floor: String(gatewayReaderFloor(step + 1)) })),
  )
})

test("#given running sessions #when a newer binary migrates the store and records a floor this binary meets #then sends keep working and a session opened afterwards sends too", async () => {
  const h = (harness = createGatewayHarness())
  h.session("A")
  h.session("B")
  expect(kindOf(await send(h, "A", "B", "before the install"))).toBe("started")

  migrateAhead(h.agentDir, GATEWAY_MIGRATIONS.length + 1, GATEWAY_MIGRATIONS.length)

  h.session("C")
  h.session("D")
  expect(kindOf(await send(h, "C", "A", "opened after the install"))).toBe("started")
  expect(kindOf(await send(h, "B", "D", "still running"))).toBe("started")
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: GATEWAY_MIGRATIONS.length + 1 })
  } finally {
    db.close()
  }
})

test.each([
  ["a floor above this binary", GATEWAY_MIGRATIONS.length + 1],
  ["no floor recorded", null],
] as const)(
  "#given a worker already open on the store #when a newer binary migrates it with %s #then the next send is refused typed and writes nothing",
  async (_case, floor) => {
    const h = (harness = createGatewayHarness())
    h.session("A")
    h.session("B")
    expect(kindOf(await send(h, "A", "B", "before the install"))).toBe("started")
    const rowsBefore = () => {
      const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
      try {
        return db.query("SELECT count(*) AS n FROM deliveries").get()
      } finally {
        db.close()
      }
    }
    const before = rowsBefore()

    migrateAhead(h.agentDir, GATEWAY_MIGRATIONS.length + 1, floor)

    const after = await settled(send(h, "B", "A", "after the incompatible install"))
    expect(after.error).toMatchObject({ code: "gateway_schema_too_new" })
    expect(rowsBefore()).toEqual(before)
  },
)

test.each([
  ["a floor above this binary (a step changed a column it uses)", GATEWAY_MIGRATIONS.length + 1],
  ["no floor recorded (a binary from before the floor)", null],
] as const)(
  "#given a newer store with %s #when a session opens it #then it is refused typed and left untouched",
  async (_case, floor) => {
    const h = (harness = createGatewayHarness())
    await h.store().identity()
    migrateAhead(h.agentDir, GATEWAY_MIGRATIONS.length + 1, floor)

    const opened = await settled(h.store().identity())
    expect(opened.error).toMatchObject({ code: "gateway_schema_too_new" })
    const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
    try {
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: GATEWAY_MIGRATIONS.length + 1 })
    } finally {
      db.close()
    }
  },
)

test("#given an omob source build #when it opens the shared agent dir's store #then it refuses to migrate it and leaves it unmigrated", async () => {
  const h = (harness = createGatewayHarness())
  const home = realpathSync(mkdtempSync(join(tmpdir(), "omo-source-build-home-")))
  const payload = join(home, "payload")
  mkdirSync(payload, { recursive: true })
  writeFileSync(join(payload, "package.json"), JSON.stringify({ version: "0.0.0", omoBuild: { command: "omob" } }))
  const sharedAgentDir = join(home, ".omo", "agent")
  mkdirSync(join(sharedAgentDir, "sessions"), { recursive: true })
  const saved = { HOME: process.env.HOME, OMO_PACKAGE_DIR: process.env.OMO_PACKAGE_DIR }
  process.env.HOME = home
  process.env.OMO_PACKAGE_DIR = payload
  cleanups.push(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(home, { recursive: true, force: true })
  })

  const opened = await settled(h.store({ agentDir: sharedAgentDir }).identity())
  expect(opened.error).toMatchObject({ code: "gateway_migration_failed" })
  const path = gatewayDatabasePath(sharedAgentDir)
  if (!existsSync(path)) return
  const db = new Database(path)
  try {
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 0 })
  } finally {
    db.close()
  }
})
