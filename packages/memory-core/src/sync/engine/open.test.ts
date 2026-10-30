import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createHttpTransport } from "./adapters/http-transport"
import { startWireServer, type WireServer } from "./adapters/wire-server.test-support"
import { FakeSealer, FakeVerifier } from "./fake-crypto.test-support"
import { gitRepo } from "./engine-harness.test-support"
import { openDeviceSync } from "./open"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

async function deviceDirs(name: string) {
  const base = await mkdtemp(join(tmpdir(), `omo-open-${name}-`))
  cleanup.push(() => rm(base, { recursive: true, force: true }))
  const repo = join(base, "repo")
  await mkdir(repo, { recursive: true })
  await gitRepo(repo)
  return { repo, state: join(base, "state"), locks: join(base, "locks") }
}

function session(server: WireServer, device: string) {
  return {
    transport: createHttpTransport({ baseUrl: server.url, token: () => server.tokenOf(device) }),
    verifier: new FakeVerifier("acct"),
    sealer: new FakeSealer("acct"),
  }
}

test("one device runs one engine: a second open on the same repo is refused until the first closes", async () => {
  const server = startWireServer({ token: "t", devices: { a: "dev-a" } })
  cleanup.push(() => server.stop())
  const dirs = await deviceDirs("a")
  const options = { repoDir: dirs.repo, stateDir: dirs.state, locksDir: dirs.locks, session: session(server, "a"), machineId: "m-a" }
  const first = await openDeviceSync(options)
  if (first === null) throw new Error("the first open was refused")
  expect(await openDeviceSync(options)).toBeNull()
  await first.close()
  const second = await openDeviceSync(options)
  expect(second).not.toBeNull()
  await second?.close()
})

test("two devices over HTTP converge through the production adapters, and the status reports it", async () => {
  const server = startWireServer({ token: "t", devices: { a: "dev-a", b: "dev-b" } })
  cleanup.push(() => server.stop())
  const [da, db] = [await deviceDirs("a"), await deviceDirs("b")]
  const a = await openDeviceSync({ repoDir: da.repo, stateDir: da.state, locksDir: da.locks, session: session(server, "a"), machineId: "m-a" })
  const b = await openDeviceSync({ repoDir: db.repo, stateDir: db.state, locksDir: db.locks, session: session(server, "b"), machineId: "m-b" })
  if (a === null || b === null) throw new Error("open refused")
  cleanup.push(() => a.close(), () => b.close())
  await Bun.write(join(da.repo, "note.md"), "---\ndescription: n\n---\nhello\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  expect(await Bun.file(join(db.repo, "note.md")).text()).toBe("---\ndescription: n\n---\nhello\n")
  expect(await b.status()).toMatchObject({ kind: "synced", updatedWhileOffline: 1 })
}, 60_000)

test("retiring the journal directory does not release the live engine lease", async () => {
  const server = startWireServer({ token: "t", devices: { a: "dev-a" } })
  cleanup.push(() => server.stop())
  const dirs = await deviceDirs("a")
  const options = { repoDir: dirs.repo, stateDir: dirs.state, locksDir: dirs.locks, session: session(server, "a"), machineId: "m-a" }
  const first = await openDeviceSync(options)
  if (first === null) throw new Error("the first open was refused")
  cleanup.push(() => first.close())
  // What SyncJournal.retire() does to a copied repo's journal while this engine holds its lease.
  await rename(join(dirs.repo, ".git", "omo-sync"), join(dirs.repo, ".git", "omo-sync.retired-test"))
  expect(await openDeviceSync(options)).toBeNull()
})
