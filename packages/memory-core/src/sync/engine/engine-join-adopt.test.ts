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

const note = (body: string) => `---\ndescription: seed note\n---\n${body}`

async function commitSeed(device: Device): Promise<void> {
  const git = ["git", "-C", device.repo.root, "-c", "user.name=seed", "-c", "user.email=seed@example.invalid"]
  await Bun.$`${git} add -A`.quiet()
  await Bun.$`${git} commit -q -m seed`.quiet()
}

async function twoSeededDevices(a: string, b: string): Promise<{ readonly a: Device; readonly b: Device }> {
  const server = new FakeSyncServer()
  const da = await makeDevice(server, "a", undefined, { realStore: true })
  const db = await makeDevice(server, "b", undefined, { realStore: true })
  devices.push(da, db)
  await da.write("system/persona.md", note(a))
  await commitSeed(da)
  await db.write("system/persona.md", note(b))
  await commitSeed(db)
  return { a: da, b: db }
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
  "#given two fresh devices with different text for one key #when both join #then every line of both is kept and the shared line appears once",
  async () => {
    const { a, b } = await twoSeededDevices("shared line\nonly on a\n", "shared line\nonly on b\n")
    await settle(a, b)
    const merged = await a.read("system/persona.md")
    expect(await b.read("system/persona.md")).toBe(merged)
    const lines = (merged ?? "").split("\n")
    for (const line of ["shared line", "only on a", "only on b"])
      expect(lines.filter((l) => l === line)).toHaveLength(1)
  },
  GIT_TEST_TIMEOUT,
)
