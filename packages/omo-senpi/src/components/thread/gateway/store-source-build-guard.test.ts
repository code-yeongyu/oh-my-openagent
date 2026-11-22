import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { gatewayDatabasePath, gatewayRootDirectory } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
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

function account(options: { readonly sourceBuild: boolean }): { readonly home: string; readonly shared: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "omo-source-build-home-")))
  const payload = join(home, "payload")
  mkdirSync(payload, { recursive: true })
  const manifest = options.sourceBuild ? { version: "0.0.0", omoBuild: { command: "omob" } } : { version: "5.2.0" }
  writeFileSync(join(payload, "package.json"), JSON.stringify(manifest))
  const shared = join(home, ".omo", "agent")
  mkdirSync(join(shared, "sessions"), { recursive: true })
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
  return { home, shared }
}

function userVersion(agentDir: string): number | undefined {
  const path = gatewayDatabasePath(agentDir)
  if (!existsSync(path)) return undefined
  const db = new Database(path, { readonly: true })
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

test("#given the shared store already at this schema #when an omob source build opens it #then it opens without migrating", async () => {
  const h = (harness = createGatewayHarness())
  const { home, shared } = account({ sourceBuild: false })
  await h.store({ agentDir: shared }).identity()
  writeFileSync(join(home, "payload", "package.json"), JSON.stringify({ omoBuild: { command: "omob" } }))

  const opened = await settled(h.store({ agentDir: shared }).identity())
  expect(opened.error).toBeUndefined()
  expect(userVersion(shared)).toBe(GATEWAY_MIGRATIONS.length)
})
