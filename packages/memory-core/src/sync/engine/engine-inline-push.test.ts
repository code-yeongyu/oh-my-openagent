import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createHttpTransport } from "./adapters/http-transport"
import { startWireServer, type WireServer } from "./adapters/wire-server.test-support"
import { gitRepo } from "./engine-harness.test-support"
import { FAKE_SPACE, FakeSealer, FakeVerifier } from "./fake-crypto.test-support"
import { type DeviceSync, openDeviceSync } from "./open"

// #14476: once the service says it takes a batch inline (omo-service #1315), a push is one request - no reservation and
// no upload - and a service that does not say so still gets the upload path.

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

async function device(server: WireServer, name: string): Promise<{ readonly sync: DeviceSync; readonly repo: string }> {
  const base = await mkdtemp(join(tmpdir(), `omo-inline-${name}-`))
  cleanup.push(() => rm(base, { recursive: true, force: true }))
  const repo = join(base, "repo")
  await mkdir(repo, { recursive: true })
  await gitRepo(repo)
  const sync = await openDeviceSync({
    repoDir: repo,
    stateDir: join(base, "state"),
    locksDir: join(base, "locks"),
    machineId: `m-${name}`,
    session: {
      transport: createHttpTransport({ baseUrl: server.url, token: () => server.tokenOf(name) }),
      verifier: new FakeVerifier("acct"),
      sealer: new FakeSealer("acct"),
      space: FAKE_SPACE,
    },
  })
  if (sync === null) throw new Error("open refused")
  cleanup.push(() => sync.close())
  return { sync, repo }
}

const NOTE = "---\ndescription: n\n---\nhello\n"
const pushRoutes = (server: WireServer, from: number) =>
  server.requests
    .slice(from)
    .filter((r) => r.method !== "GET")
    .map((r) => `${r.method} ${r.path.replace(/^(\/v1\/sync\/uploads)\/.+$/, "$1/:id")}`)

for (const { inline, expected } of [
  { inline: true, expected: ["POST /v1/sync/batches"] },
  { inline: false, expected: ["POST /v1/sync/uploads", "PUT /v1/sync/uploads/:id", "POST /v1/sync/batches"] },
])
  test(`a service ${inline ? "that takes" : "that does not take"} inline batches gets ${expected.length} push request(s), and the other device converges`, async () => {
    const server = startWireServer({ token: "t", devices: { a: "dev-a", b: "dev-b" }, inline })
    cleanup.push(() => server.stop())
    const [a, b] = [await device(server, "a"), await device(server, "b")]
    await a.sync.engine.runCycle()
    const from = server.requests.length
    await Bun.write(join(a.repo, "note.md"), NOTE)
    expect((await a.sync.engine.runCycle()).pushed).toBe(true)
    expect(pushRoutes(server, from)).toEqual(expected)
    await b.sync.engine.runCycle()
    expect(await Bun.file(join(b.repo, "note.md")).text()).toBe(NOTE)
  })
