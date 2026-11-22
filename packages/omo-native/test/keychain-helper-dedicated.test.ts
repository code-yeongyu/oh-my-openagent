import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { ACCOUNT, createHarness, type Harness, isDarwin, userSearchList } from "./keychain-helper.test-support"

const request = (verb: string, extra: Record<string, string> = {}) => ({ v: 1, verb, account: ACCOUNT, ...extra })
const omo = (verb: string, extra: Record<string, string> = {}) => request(verb, { ...extra, store: "omo" })
const migrate = (verb: string, extra: Record<string, string> = {}) => request(verb, { ...extra, store: "omo-migrate" })

describe.skipIf(!isDarwin)("omo-keychain helper: OmO's own keychain (#13116 design r2)", () => {
  let harness: Harness
  let searchListBefore = ""
  let parent = ""
  let root = ""
  // The throwaway keychain stands in for the login keychain; the store root replaces ~/Library/Application Support/OmO.
  const run = (body: object) =>
    harness.run(body, { args: ["--keychain", harness.keychain, "--no-ui", "--store-root", root] })
  const dedicatedKeychain = () => join(root, "omo-credentials.keychain-db")
  const activeStore = async () => {
    expect((await run(omo("store-create"))).reply).toEqual({ ok: true, created: true })
    expect((await run(omo("store-activate"))).reply).toEqual({ ok: true })
  }

  beforeAll(async () => {
    searchListBefore = await userSearchList()
    harness = await createHarness()
    parent = join(harness.dir, "OmO")
    root = join(parent, "credential-keychain")
  })

  beforeEach(async () => {
    if (existsSync(dedicatedKeychain())) await harness.fixtureAt("destroy", dedicatedKeychain())
    rmSync(parent, { recursive: true, force: true })
    mkdirSync(parent, { mode: 0o700 })
  })

  afterAll(async () => {
    if (existsSync(dedicatedKeychain())) await harness.fixtureAt("destroy", dedicatedKeychain())
    await harness.dispose()
    expect(await userSearchList()).toBe(searchListBefore)
  })

  test("store-create builds an owner-only store, idempotently, and leaves it inactive", async () => {
    expect((await run(omo("store-create"))).reply).toEqual({ ok: true, created: true })
    expect((await run(omo("store-create"))).reply).toEqual({ ok: true, skipped: true })
    expect(lstatSync(root).mode & 0o777).toBe(0o700)
    expect(lstatSync(dedicatedKeychain()).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(root, "unlock-key")).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(root, "unlock-key"), "utf8")).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(join(root, "active"))).toBe(false)
    expect((await run(request("read"))).reply).toMatchObject({ missing: true })
    expect((await run(omo("read"))).reply).toEqual({ error: "store-refused", reason: "store-inactive" })
  })

  test("items in OmO's keychain live there only, and any application may decrypt them without a prompt", async () => {
    await activeStore()
    expect((await run(omo("write", { value: "dummy-dedicated" }))).reply).toEqual({ ok: true, created: true })
    expect((await run(omo("read"))).reply).toMatchObject({ owned: true, value: "dummy-dedicated", marker: true })
    expect((await run(request("read", { store: "login" }))).reply).toMatchObject({ missing: true })
    expect(await harness.fixtureAt("decrypt-apps", dedicatedKeychain(), ACCOUNT)).toContain("decrypt-apps -1")
    expect(await harness.fixtureAt("read", dedicatedKeychain(), ACCOUNT)).toContain("value dummy-dedicated")
    expect((await run(omo("approve"))).reply).toMatchObject({ value: "dummy-dedicated" })
    expect((await run(omo("remove"))).reply).toEqual({ ok: true })
    expect((await run(omo("read"))).reply).toMatchObject({ missing: true })
  })

  test("while active, a request naming no store is refused and an explicit login request still reaches the login keychain", async () => {
    await activeStore()
    expect((await run(request("write", { value: "dummy" }))).reply).toEqual({
      error: "store-refused",
      reason: "store-required",
    })
    expect((await run(request("read"))).reply).toEqual({ error: "store-refused", reason: "store-required" })
    expect((await run(request("write", { value: "dummy-login", store: "login" }))).reply).toEqual({
      ok: true,
      created: true,
    })
    expect((await run(omo("read"))).reply).toMatchObject({ missing: true })
    expect((await run(request("remove", { store: "login" }))).reply).toEqual({ ok: true })
    expect((await run(omo("store-erase"))).reply).toEqual({ error: "store-refused", reason: "active" })
    expect((await run(omo("store-deactivate"))).reply).toEqual({ ok: true })
    expect((await run(request("read"))).reply).toMatchObject({ missing: true })
  })

  test("the migration form reaches an inactive store; store-erase keeps a sign-in and drops only retired slots", async () => {
    await run(omo("store-create"))
    expect((await run(migrate("write", { value: "dummy" }))).reply).toEqual({ ok: true, created: true })
    expect((await run(omo("store-erase"))).reply).toEqual({ error: "store-refused", reason: "not-empty" })
    expect((await run(migrate("retire"))).reply).toEqual({ ok: true, slot: 0 })
    expect((await run(omo("store-erase"))).reply).toEqual({ ok: true })
    expect(existsSync(root)).toBe(false)
    expect((await run(migrate("store-create"))).reply).toEqual({ error: "refused", reason: "store" })
  })

  test("store-erase finishes a store whose keychain file is already gone (a crash between delete and folder removal)", async () => {
    await run(omo("store-create"))
    await harness.fixtureAt("destroy", dedicatedKeychain())
    expect(existsSync(dedicatedKeychain())).toBe(false)
    expect((await run(omo("read"))).reply).toMatchObject({ error: "store-refused" })
    expect((await run(omo("store-erase"))).reply).toEqual({ ok: true })
    expect(existsSync(root)).toBe(false)
  })

  test("store-create removes a partial store a crashed create left behind", async () => {
    const partial = `${root}.partial-999999`
    mkdirSync(partial, { mode: 0o700 })
    writeFileSync(join(partial, "unlock-key"), "f".repeat(64), { mode: 0o600 })
    expect((await run(omo("store-create"))).reply).toEqual({ ok: true, created: true })
    expect(existsSync(partial)).toBe(false)
  })

  test("a damaged active store can still be deactivated, after which requests naming no store reach the login keychain", async () => {
    await activeStore()
    chmodSync(join(root, "unlock-key"), 0o644)
    expect((await run(omo("read"))).reply).toMatchObject({ error: "store-refused", reason: "key" })
    expect((await run(omo("store-deactivate"))).reply).toEqual({ ok: true })
    expect((await run(request("read"))).reply).toMatchObject({ missing: true })
    chmodSync(join(root, "unlock-key"), 0o600)
  })

  test("a symlinked store folder is refused even when it points at a valid store", async () => {
    await activeStore()
    renameSync(root, `${root}-real`)
    symlinkSync(`${root}-real`, root)
    expect((await run(omo("write", { value: "dummy" }))).reply).toMatchObject({
      error: "store-refused",
      reason: "symlink",
    })
    rmSync(root)
    renameSync(`${root}-real`, root)
  })

  test("a damaged store is refused by name and never falls back to the login keychain", async () => {
    await activeStore()
    const key = join(root, "unlock-key")
    const refused = async (reason: string) => {
      expect((await run(omo("write", { value: "dummy-fallback" }))).reply).toMatchObject({
        error: "store-refused",
        reason,
      })
      expect((await run(request("read", { store: "login" }))).reply).toMatchObject({ missing: true })
    }
    chmodSync(root, 0o755)
    await refused("mode")
    chmodSync(root, 0o700)
    chmodSync(parent, 0o770)
    await refused("parent")
    chmodSync(parent, 0o700)
    chmodSync(key, 0o644)
    await refused("key")
    chmodSync(key, 0o600)
    const original = readFileSync(key, "utf8")
    writeFileSync(key, "abc", { mode: 0o600 })
    await refused("key")
    rmSync(key)
    writeFileSync(join(harness.dir, "elsewhere"), original, { mode: 0o600 })
    symlinkSync(join(harness.dir, "elsewhere"), key)
    await refused("key")
    rmSync(key)
    await refused("missing")
    writeFileSync(key, "f".repeat(64), { mode: 0o600 })
    await harness.fixtureAt("lock", dedicatedKeychain())
    await refused("unlock")
    writeFileSync(key, original, { mode: 0o600 })
  })

  test("store verbs need the store field, and the store field takes only omo, omo-migrate or login", async () => {
    expect((await run(request("store-create"))).reply).toEqual({ error: "refused", reason: "missing-store" })
    expect((await run(request("read", { store: "other" }))).reply).toEqual({ error: "refused", reason: "store" })
    expect((await run(request("store-create", { store: "login" }))).reply).toEqual({
      error: "refused",
      reason: "store",
    })
    expect(existsSync(root)).toBe(false)
  })
})
