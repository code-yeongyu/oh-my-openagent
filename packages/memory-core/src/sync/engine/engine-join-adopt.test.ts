import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

// #13725: a device whose working tree has no shared CRDT history with the space joins it insert-only
// (sync-design §3, space/adopt.ts). Every memory repository is seeded with the same default files, so two
// devices that start syncing one space hold identical text for the same keys; that text must land once, and
// differing text must keep every line of both sides without repeating the lines they share.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const crashAt = (point: string) => (at: string) => {
  if (at === point) throw new Error(`crash injected at ${point}`)
}

const note = (body: string) => `---\ndescription: seed note\n---\n${body}`

async function commitSeed(device: Device): Promise<void> {
  const git = ["git", "-C", device.repo.root, "-c", "user.name=seed", "-c", "user.email=seed@example.invalid"]
  await Bun.$`${git} add -A`.quiet()
  await Bun.$`${git} commit -q -m seed`.quiet()
}

async function twoSeededDevices(
  a: string,
  b: string,
): Promise<{ readonly a: Device; readonly b: Device; readonly server: FakeSyncServer }> {
  const server = new FakeSyncServer()
  const da = await makeDevice(server, "a", undefined, { realStore: true })
  const db = await makeDevice(server, "b", undefined, { realStore: true })
  devices.push(da, db)
  await da.write("system/persona.md", note(a))
  await commitSeed(da)
  await db.write("system/persona.md", note(b))
  await commitSeed(db)
  return { a: da, b: db, server }
}

async function settle(a: Device, b: Device): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await a.engine.runCycle()
    await b.engine.runCycle()
  }
}

const SEED = "You are a coding agent.\nKeep it short.\n"

test(
  "#given two fresh devices seeded with identical text #when both join one space #then the text lands once on both",
  async () => {
    const { a, b } = await twoSeededDevices(SEED, SEED)
    await settle(a, b)
    expect(await a.read("system/persona.md")).toBe(note(SEED))
    expect(await b.read("system/persona.md")).toBe(note(SEED))
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given a device that synced its seed first #when a second device with the identical seed joins later #then the text lands once on both",
  async () => {
    const { a, b } = await twoSeededDevices(SEED, SEED)
    await a.engine.runCycle()
    await a.engine.runCycle()
    await settle(b, a)
    expect(await b.read("system/persona.md")).toBe(note(SEED))
    expect(await a.read("system/persona.md")).toBe(note(SEED))
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given a device that captured its identical seed before the other device's batch landed #when its push meets a stale base #then the text lands once on both",
  async () => {
    const { a, b, server } = await twoSeededDevices(SEED, SEED)
    server.beforeNextAppend = async () => {
      server.beforeNextAppend = null
      await a.engine.runCycle()
    }
    const pushed = b.engine.runCycle()
    await b.clock.untilPending()
    b.clock.advance(8_000)
    await pushed
    await settle(a, b)
    expect(await b.read("system/persona.md")).toBe(note(SEED))
    expect(await a.read("system/persona.md")).toBe(note(SEED))
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given a joining rewind that crashed after the store write #when the device restarts and syncs #then the seed lands once on both",
  async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true })
    const b = await makeDevice(server, "b", crashAt("rewound-joining"), { realStore: true })
    devices.push(a, b)
    await a.write("system/persona.md", note(SEED))
    await commitSeed(a)
    await b.write("system/persona.md", note(SEED))
    await commitSeed(b)
    server.beforeNextAppend = async () => {
      server.beforeNextAppend = null
      await a.engine.runCycle()
    }
    const pushed = b.engine.runCycle().catch(() => undefined)
    await b.clock.untilPending()
    b.clock.advance(8_000)
    await pushed
    await b.restart()
    await settle(a, b)
    expect(await b.read("system/persona.md")).toBe(note(SEED))
    expect(await a.read("system/persona.md")).toBe(note(SEED))
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given a first push that stopped after sealing, before any append #when the other device's copy lands and it syncs again #then the seed lands once on both",
  async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true })
    const b = await makeDevice(server, "b", crashAt("sealed"), { realStore: true })
    devices.push(a, b)
    await a.write("system/persona.md", note(SEED))
    await commitSeed(a)
    await b.write("system/persona.md", note(SEED))
    await commitSeed(b)
    const crashed = b.engine.runCycle().catch(() => undefined)
    await Promise.race([crashed, b.clock.untilPending()])
    await a.engine.runCycle()
    await b.restart()
    const resumed = b.engine.runCycle().catch(() => undefined)
    // The dropped first batch is not resent, so the resumed push appends directly instead of backing off on a stale base.
    expect(await Promise.race([resumed.then(() => "appended"), b.clock.untilPending().then(() => "backing off")])).toBe(
      "appended",
    )
    await settle(a, b)
    expect(await b.read("system/persona.md")).toBe(note(SEED))
    expect(await a.read("system/persona.md")).toBe(note(SEED))
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given two fresh devices with different text for one key #when both join #then every line of both is kept and the shared line appears once",
  async () => {
    const { a, b } = await twoSeededDevices("shared line\nonly on a\n", "shared line\nonly on b\n")
    await a.engine.runCycle()
    expect((await b.engine.runCycle()).pushed).toBe(true)
    await settle(a, b)
    const merged = await a.read("system/persona.md")
    expect(await b.read("system/persona.md")).toBe(merged)
    const lines = (merged ?? "").split("\n")
    for (const line of ["shared line", "only on a", "only on b"])
      expect(lines.filter((l) => l === line)).toHaveLength(1)
  },
  GIT_TEST_TIMEOUT,
)
