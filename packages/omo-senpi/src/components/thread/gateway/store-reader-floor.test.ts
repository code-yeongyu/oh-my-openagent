import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GatewayDeliverRequest } from "./engine"
import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"

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
