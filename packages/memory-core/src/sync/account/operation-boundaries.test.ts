import { afterEach, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs/promises"
import { basename } from "node:path"
import * as journal from "../../journal/fsync.ts"
import { renameWithContentionRetry } from "../../fs/rename-contention.ts"
import { signedAppend } from "../recovery/keyring-append.ts"
import { pinTrustAnchor, loadTrustAnchor } from "../crypto/trust-pin.ts"
import { walk, EMPTY_HEAD } from "../genesis/vector.test-support.ts"
import { createAccountHttp } from "./http.ts"
import { createPairingHttp } from "./pairing-http.ts"
import { enableSync } from "./enable.ts"
import { ACCOUNT, fixture, operationScope } from "./testing/genesis-enable.test-support.ts"

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const setup = async () => { const f = await fixture(); cleanup.push(f.close); return f }

test("record signing rechecks authority after asynchronous digest and link preparation", async () => {
  const f = await setup()
  const { controller, operation } = operationScope()
  let signs = 0
  const keyring = { ...f.keyring, sign: async (request: Parameters<typeof f.keyring.sign>[0]) => { signs++; return f.keyring.sign(request) } }
  const pending = signedAppend(keyring, EMPTY_HEAD, f.prepared.body, f.prepared.wraps, operation)
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(signs).toBe(0)
})

for (const port of ["chain", "pairing"] as const) {
  test(`${port} dispatch rechecks authority after token acquisition`, async () => {
    const f = await setup()
    const { controller, operation } = operationScope()
    const entered = Promise.withResolvers<void>()
    const token = Promise.withResolvers<string>()
    let dispatched = 0
    const options = {
      baseUrl: f.server.url, ...operation,
      token: () => { entered.resolve(); return token.promise },
      fetch: Object.assign(async () => { dispatched++; return Response.json({ seq: 1 }) }, { preconnect: fetch.preconnect }),
    }
    const pending = port === "chain"
      ? createAccountHttp(options).appendKeys(f.built.request)
      : createPairingHttp(options).setAccountSync(true)
    await entered.promise
    controller.abort()
    token.resolve("synthetic")
    await expect(pending).rejects.toThrow()
    expect(dispatched).toBe(0)
  })
}

test("pin cancellation during staging prevents publication", async () => {
  const f = await setup()
  const result = await walk(f.built.request, f.keyring)
  if (!result.ok || result.state.pin === null) throw new Error("fixture walk")
  const { controller, operation } = operationScope()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const original = journal.syncJournalDirectory
  const spy = spyOn(journal, "syncJournalDirectory").mockImplementation(async (path) => {
    await original(path)
    if (path.endsWith(".tmp")) { entered.resolve(); await release.promise }
  })
  cleanup.push(() => spy.mockRestore())
  const pending = pinTrustAnchor(f.input.pinDir, ACCOUNT, result.state.pin, operation)
  await entered.promise
  controller.abort()
  release.resolve()
  await expect(pending).rejects.toThrow()
  expect((await loadTrustAnchor(f.input.pinDir, ACCOUNT)).ok).toBe(false)
})

test("published pin finishes parent fsync and readback even when its owner retires", async () => {
  const f = await setup()
  const result = await walk(f.built.request, f.keyring)
  if (!result.ok || result.state.pin === null) throw new Error("fixture walk")
  const { controller, operation } = operationScope()
  const original = fs.rename
  const renamed = spyOn(fs, "rename").mockImplementation(async (from, to) => { await original(from, to); controller.abort() })
  cleanup.push(() => renamed.mockRestore())
  const synced: string[] = []
  const sync = journal.syncJournalDirectory
  const syncedSpy = spyOn(journal, "syncJournalDirectory").mockImplementation(async (path) => { synced.push(path); await sync(path) })
  cleanup.push(() => syncedSpy.mockRestore())
  await expect(pinTrustAnchor(f.input.pinDir, ACCOUNT, result.state.pin, operation)).rejects.toThrow()
  expect((await loadTrustAnchor(f.input.pinDir, ACCOUNT)).ok).toBe(true)
  expect(synced.some((path) => basename(path) === "trust-anchor")).toBe(true)
})

test("raw rename EINTR retry cannot bypass retired authority", async () => {
  const { controller, operation } = operationScope()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let calls = 0
  const raw = async () => {
    calls++
    if (calls === 1) {
      entered.resolve()
      await release.promise
      throw Object.assign(new Error("interrupted"), { code: "EINTR" })
    }
  }
  const pending = renameWithContentionRetry("staging", "target", { platform: "darwin", rename: raw, admit: operation.authority.admit })
  await entered.promise
  controller.abort()
  release.resolve()
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  expect(calls).toBe(1)
})

test("Windows contention retries re-admit the raw rename after suspension", async () => {
  const { controller, operation } = operationScope()
  const waiting = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let calls = 0
  const pending = renameWithContentionRetry("staging", "target", {
    platform: "win32", admit: operation.authority.admit,
    rename: async () => { calls++; if (calls === 1) throw Object.assign(new Error("busy"), { code: "EPERM" }) },
    sleep: async () => { waiting.resolve(); await release.promise },
  })
  await waiting.promise
  controller.abort()
  release.resolve()
  await expect(pending).rejects.toThrow()
  expect(calls).toBe(1)
})

test("late bridge completion after cancellation cannot sign or publish genesis", async () => {
  const f = await setup()
  const { controller, operation } = operationScope()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let signs = 0
  const pending = enableSync({
    ...f.input, ...operation,
    keyring: { ...f.keyring, sign: async (request) => { signs++; return f.keyring.sign(request) } },
    genesis: {
      prfSupported: true,
      createGenesis: async () => { entered.resolve(); await release.promise; return { ok: true, prepared: f.prepared } },
    },
  })
  await entered.promise
  controller.abort()
  release.resolve()
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  expect(signs).toBe(0)
  expect(f.entries).toHaveLength(0)
  expect(f.server.switches.every((line) => !line.includes("false"))).toBe(true)
})

test("published intent finishes durability after cancellation and resumes without another ceremony", async () => {
  const f = await setup()
  const { controller, operation } = operationScope()
  const original = fs.rename
  const renamed = spyOn(fs, "rename").mockImplementation(async (from, to) => {
    await original(from, to)
    if (String(to).split(/[\\/]/).includes("genesis-intent")) controller.abort()
  })
  cleanup.push(() => renamed.mockRestore())
  const synced: string[] = []
  const sync = journal.syncJournalDirectory
  const syncSpy = spyOn(journal, "syncJournalDirectory").mockImplementation(async (path) => { synced.push(path); await sync(path) })
  cleanup.push(() => syncSpy.mockRestore())
  await expect(enableSync({ ...f.input, ...operation })).rejects.toMatchObject({ name: "AbortError" })
  expect(synced.some((path) => basename(path) === "genesis-intent")).toBe(true)
  expect(f.entries).toHaveLength(0)
  renamed.mockRestore()
  expect(await enableSync(f.input)).toEqual({ kind: "joined", created: true })
  expect(f.ceremonies()).toBe(1)
})
