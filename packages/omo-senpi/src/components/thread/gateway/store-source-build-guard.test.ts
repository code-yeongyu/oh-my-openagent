import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { gatewayDatabasePath, gatewayRootDirectory } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { Sql, type SqliteConnection } from "./sql"
import { migrate, type StoreContext } from "./store-ops"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import { settled } from "./testing/settled"

// An omob source build never migrates a gateway store released sessions on the device may read (#14382, #14622 reviews
// M2-M4, M8). Each case runs the real store worker with HOME at a temp account home; the worker reads the env at start.

let harness: GatewayHarness | undefined
const cleanups: (() => void)[] = []
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function account(options: { readonly sourceBuild: boolean; readonly launched?: boolean }): {
  readonly home: string
  readonly shared: string
} {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "omo-source-build-home-")))
  const payload = join(home, "payload")
  mkdirSync(payload, { recursive: true })
  const manifest = options.sourceBuild ? { version: "0.0.0", omoBuild: { command: "omob" } } : { version: "5.2.0" }
  writeFileSync(join(payload, "package.json"), JSON.stringify(manifest))
  const shared = join(home, ".omo", "agent")
  mkdirSync(join(shared, "sessions"), { recursive: true })
  const saved = { HOME: process.env.HOME, OMO_PACKAGE_DIR: process.env.OMO_PACKAGE_DIR }
  process.env.HOME = home
  if (options.launched === false) delete process.env.OMO_PACKAGE_DIR
  else process.env.OMO_PACKAGE_DIR = payload
  cleanups.push(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(home, { recursive: true, force: true })
  })
  return { home, shared }
}

// Opened read-write without create, never read-only: the store worker leaves the file in WAL mode, and SQLite on macOS
// refuses a read-only open of a WAL database whose -shm file is gone (SQLITE_CANTOPEN). Reading
// user_version writes no schema; the header bytes alone are not enough, since a migration may still sit in the WAL.
function userVersion(agentDir: string): number | undefined {
  const path = gatewayDatabasePath(agentDir)
  if (!existsSync(path)) return undefined
  const db = new Database(path, { readwrite: true, create: false })
  try {
    return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version
  } finally {
    db.close()
  }
}

test("#given an omob source build #when it opens the shared agent dir's store #then it refuses to migrate it and leaves it unmigrated", async () => {
  const h = (harness = createGatewayHarness())
  const { shared } = account({ sourceBuild: true })

  const opened = await settled(h.store({ agentDir: shared }).identity())
  expect(opened.error).toMatchObject({ code: "gateway_migration_failed" })
  expect(userVersion(shared) ?? 0).toBe(0)
})

test("#given a run from TypeScript source that no launcher started #when it opens the shared agent dir's store #then it refuses to migrate it", async () => {
  const h = (harness = createGatewayHarness())
  const { shared } = account({ sourceBuild: false, launched: false })

  const opened = await settled(h.store({ agentDir: shared }).identity())
  expect(opened.error).toMatchObject({ code: "gateway_migration_failed" })
  expect(userVersion(shared) ?? 0).toBe(0)
})

test("#given a run from TypeScript source that no launcher started #when it opens an isolated agent dir's store #then it migrates it", async () => {
  const h = (harness = createGatewayHarness())
  const { home } = account({ sourceBuild: false, launched: false })
  const isolated = join(home, "isolated-agent")
  mkdirSync(isolated, { recursive: true })

  const opened = await settled(h.store({ agentDir: isolated }).identity())
  expect(opened.error).toBeUndefined()
  expect(userVersion(isolated)).toBe(GATEWAY_MIGRATIONS.length)
})

test("#given a release build #when it opens the shared agent dir's store #then it migrates it", async () => {
  const h = (harness = createGatewayHarness())
  const { shared } = account({ sourceBuild: false })

  const opened = await settled(h.store({ agentDir: shared }).identity())
  expect(opened.error).toBeUndefined()
  expect(userVersion(shared)).toBe(GATEWAY_MIGRATIONS.length)
})

test("#given an omob source build #when it opens an isolated agent dir's store #then it migrates it", async () => {
  const h = (harness = createGatewayHarness())
  const { home } = account({ sourceBuild: true })
  const isolated = join(home, "isolated-agent")
  mkdirSync(isolated, { recursive: true })

  const opened = await settled(h.store({ agentDir: isolated }).identity())
  expect(opened.error).toBeUndefined()
  expect(userVersion(isolated)).toBe(GATEWAY_MIGRATIONS.length)
})

test.skipIf(process.platform === "win32")(
  "#given an omob source build with a separate agent dir whose gateway/ links to the shared store's #when it opens the store #then it refuses to migrate it (#14622 review M8)",
  async () => {
    const h = (harness = createGatewayHarness())
    const { home, shared } = account({ sourceBuild: true })
    mkdirSync(gatewayRootDirectory(shared), { recursive: true })
    const isolated = join(home, "isolated-agent")
    mkdirSync(isolated, { recursive: true })
    symlinkSync(gatewayRootDirectory(shared), gatewayRootDirectory(isolated))

    const opened = await settled(h.store({ agentDir: isolated }).identity())
    expect(opened.error).toMatchObject({ code: "gateway_migration_failed" })
    expect(userVersion(shared) ?? 0).toBe(0)
  },
)

test.skipIf(process.platform === "win32").each([
  ["an existing shared database", true],
  ["a shared database not created yet", false],
] as const)(
  "#given an omob source build whose agent dir has its own gateway/ but links gateway.sqlite to %s #when it opens the store #then it refuses to migrate it (#14622 review M9)",
  async (_case, existing) => {
    const h = (harness = createGatewayHarness())
    const { home, shared } = account({ sourceBuild: true })
    mkdirSync(gatewayRootDirectory(shared), { recursive: true })
    if (existing) new Database(gatewayDatabasePath(shared)).close()
    const isolated = join(home, "isolated-agent")
    mkdirSync(gatewayRootDirectory(isolated), { recursive: true })
    symlinkSync(gatewayDatabasePath(shared), gatewayDatabasePath(isolated))

    const opened = await settled(h.store({ agentDir: isolated }).identity())
    expect(opened.error).toMatchObject({ code: "gateway_migration_failed" })
    expect(userVersion(shared) ?? 0).toBe(0)
  },
)

/** A migrate context whose worker opened `databasePath` (links resolved) for an agent dir configured as `agentDir`. */
function openedContext(agentDir: string, databasePath: string): StoreContext {
  const db = new Database(":memory:")
  const connection: SqliteConnection = {
    exec: (sql) => db.exec(sql),
    function: (name, options, fn) => db.function(name, options, fn as never),
    setAuthorizer: () => {
      throw new Error("migrate never installs an authorizer")
    },
    close: () => db.close(),
  }
  cleanups.push(() => db.close())
  return {
    sql: new Sql(connection),
    config: { agent_dir: agentDir, test_hooks: {}, busy_timeout_ms: 1_000, lock_wait_max_ms: 5_000 },
    databasePath,
    stats: { writes: 0, marker_unlinks: 0, transactions: 0 },
    emit: () => undefined,
    hook: async () => undefined,
    delay: async () => undefined,
  } as unknown as StoreContext
}

// The configured paths are isolated (the source build's own link was retargeted after the worker resolved it), and the
// worker opened the shared database: by its default path, or where a link in the shared agent dir keeps it (review M9).
test.skipIf(process.platform === "win32").each([
  ["in the default layout", false],
  ["outside the default layout (the shared gateway.sqlite links to <home>/data/thread.sqlite)", true],
] as const)(
  "#given an omob source build whose configured paths are isolated #when the file the worker actually opened is the shared database %s #then it refuses to migrate it",
  async (_case, outside) => {
    const { home, shared } = account({ sourceBuild: true })
    mkdirSync(gatewayRootDirectory(shared), { recursive: true })
    let opened = gatewayDatabasePath(shared)
    if (outside) {
      mkdirSync(join(home, "data"), { recursive: true })
      opened = join(home, "data", "thread.sqlite")
      symlinkSync(opened, gatewayDatabasePath(shared))
    }
    new Database(opened).close()
    const isolated = join(home, "isolated-agent")
    mkdirSync(gatewayRootDirectory(isolated), { recursive: true })

    expect((await settled(migrate(openedContext(isolated, realpathSync(opened))))).error).toMatchObject({
      code: "gateway_migration_failed",
    })
  },
)

test("#given an omob source build #when the file the worker opened is a database no shared agent dir names #then it migrates it", async () => {
  const { home } = account({ sourceBuild: true })
  const isolated = join(home, "isolated-agent")
  mkdirSync(gatewayRootDirectory(isolated), { recursive: true })
  mkdirSync(join(home, "data"), { recursive: true })
  const unrelated = join(home, "data", "unrelated.sqlite")
  new Database(unrelated).close()

  expect((await settled(migrate(openedContext(isolated, unrelated)))).error).toBeUndefined()
})

test("#given the shared store already at this schema #when an omob source build opens it #then it opens without migrating", async () => {
  const h = (harness = createGatewayHarness())
  const { home, shared } = account({ sourceBuild: false })
  await h.store({ agentDir: shared }).identity()
  writeFileSync(join(home, "payload", "package.json"), JSON.stringify({ omoBuild: { command: "omob" } }))

  const opened = await settled(h.store({ agentDir: shared }).identity())
  expect(opened.error).toBeUndefined()
  expect(userVersion(shared)).toBe(GATEWAY_MIGRATIONS.length)
})
