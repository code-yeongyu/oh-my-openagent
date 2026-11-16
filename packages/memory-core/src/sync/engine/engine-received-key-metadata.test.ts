import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { gitConfigBytes, gitConfigValue, item, publish, rekey } from "./received-keys.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

async function receiver(server: FakeSyncServer, options: { realStore?: boolean } = {}): Promise<Device> {
  const b = await makeDevice(server, "b", undefined, options)
  devices.push(b)
  await b.engine.runCycle()
  return b
}

test(
  "a received key naming the repository config is dropped with a receipt and the good item in the same batch lands",
  async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true })
    devices.push(a)
    await a.write("seed.md", "[omo-test]\n\tmarker = landed\n")
    await a.write("good.md", "---\ndescription: good\n---\nbody\n")
    await a.engine.runCycle()
    rekey(server, 1, { "seed.md": ".git/config" })
    const b = await makeDevice(server, "b", undefined, { realStore: true })
    devices.push(b)
    const config = await gitConfigBytes(b)
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1, refused: 0, rejectedItems: 1 })
    expect(await gitConfigBytes(b)).toBe(config)
    expect(await gitConfigValue(b, "omo-test.marker")).toBeNull()
    expect(await b.read("good.md")).toBe(await a.read("good.md"))
    expect(await b.engine.state()).toMatchObject({ applied: 1, cycle: null, paused: null, rejectedItems: 1 })
  },
  GIT_TEST_TIMEOUT,
)

test(
  "every spelling that resolves to the repository metadata directory is dropped and the cycle completes",
  async () => {
    const server = new FakeSyncServer()
    const b = await receiver(server)
    const config = await gitConfigBytes(b)
    const spellings = [
      ".Git/config",
      ".GIT/config",
      ".git./config",
      ".git /config",
      "GIT~1/config",
      "git~12/hooks/x",
      ".g\u200cit/config",
      "sub/.git/config",
    ]
    for (const [i, key] of spellings.entries()) {
      const seq = await publish(server, item(key, "[omo-test]"), item(`ok-${i}.md`, `ok ${i}`))
      expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })
      expect(await b.read(`ok-${i}.md`)).toBe(`ok ${i}\n`)
      expect(await b.engine.state()).toMatchObject({ applied: seq, cycle: null, paused: null })
    }
    expect(await gitConfigBytes(b)).toBe(config)
    expect(await b.workingFiles()).toEqual([".gitkeep", ...spellings.map((_, i) => `ok-${i}.md`)].sort())
  },
  GIT_TEST_TIMEOUT,
)

test(
  "a mixed batch lands its good items byte-identical and drops only the bad one",
  async () => {
    const server = new FakeSyncServer()
    const b = await receiver(server)
    const config = await gitConfigBytes(b)
    const seq = await publish(server, item("a.md", "alpha"), item(".git/config", "[omo-test]"), item("b.md", "beta"))
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1, refused: 0, rejectedItems: 1 })
    expect([await b.read("a.md"), await b.read("b.md")]).toEqual(["alpha\n", "beta\n"])
    expect(await gitConfigBytes(b)).toBe(config)
    expect(await b.engine.state()).toMatchObject({ applied: seq, cycle: null, paused: null, rejectedItems: 1 })
    expect(await b.engine.status()).toMatchObject({ kind: "synced" })
  },
  GIT_TEST_TIMEOUT,
)

test(
  "a received key naming the sync journal leaves the journal untouched and the device keeps pushing",
  async () => {
    const server = new FakeSyncServer()
    const b = await makeDevice(server, "b")
    devices.push(b)
    await b.write("local.md", "local\n")
    expect(await b.engine.runCycle()).toMatchObject({ pushed: true })
    const pendingPath = join(b.repo.gitDir, "omo-sync", "pending.json")
    const pending = await readFile(pendingPath, "utf8")
    await publish(server, item(".git/omo-sync/pending.json", "{}"), item("ok.md", "ok"))
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })
    expect(await readFile(pendingPath, "utf8")).toBe(pending)
    await b.write("mine.md", "mine\n")
    expect(await b.engine.runCycle()).toMatchObject({ pushed: true })
    expect(server.head).toBe(3)
  },
  GIT_TEST_TIMEOUT,
)
