// A peer's edit to a file this device holds back (#12284 review H1) is never lost on the holding
// device: it waits in the item doc while the person's oversized edit stays on disk, and lands in the
// file, committed, once that file fits again, through any crash on the way.

import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"

import { CrashInjected } from "./engine"
import { type Device, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const TIMEOUT = 60_000
const BOUND = 4096
const RENDER_POINTS = [
  "captured",
  "persisted",
  "merged",
  "staged",
  "render-intent",
  "render-key",
  "rendered",
  "git-commit",
  "committed",
  "checkpointed",
] as const

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, TIMEOUT)

const note = (body: string) => `---\ndescription: note\n---\n${body}`
const crashAt = (point: string) => (at: string) => {
  if (at === point) throw new CrashInjected(point)
}
const uncommitted = (device: Device): string =>
  execFileSync("git", ["status", "--porcelain"], {
    cwd: device.repo.root,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  }).toString()

/** A holds shared.md (too large to push) while B edits it; B's edit reaches A's doc but not A's file. */
async function heldWithPeerEdit() {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true, batchBytes: BOUND })
  const b = await makeDevice(server, "b", undefined, { realStore: true, batchBytes: BOUND })
  devices.push(a, b)
  await a.write("shared.md", note("first\n"))
  await a.engine.runCycle()
  await b.engine.runCycle()
  const big = note(`first\n${"y".repeat(BOUND * 2)}\n`)
  await a.write("shared.md", big)
  await a.engine.runCycle()
  await b.write("shared.md", note("first\nfrom b\n"))
  await b.engine.runCycle()
  expect(await a.engine.runCycle()).toMatchObject({ applied: 1, held: ["shared.md"] })
  expect(await a.read("shared.md")).toBe(big)
  return { a, b }
}

async function expectBothEditsOnBoth(a: Device, b: Device) {
  await b.engine.runCycle()
  const [onA, onB] = [await a.read("shared.md"), await b.read("shared.md")]
  for (const piece of ["first", "from a", "from b"]) expect(onA).toContain(piece)
  expect(onA).toBe(onB)
  expect(await a.engine.status()).toMatchObject({ kind: "synced" })
  expect(uncommitted(a)).toBe("")
}

test(
  "once the held file fits, the peer's edit lands in the holding device's own file too, committed, and both devices agree",
  async () => {
    const { a, b } = await heldWithPeerEdit()
    await a.write("shared.md", note("first\nfrom a\n"))
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true, held: [] })
    await expectBothEditsOnBoth(a, b)
    const commits = (await a.syncCommits()).length
    await a.engine.runCycle()
    expect((await a.syncCommits()).length).toBe(commits)
  },
  TIMEOUT,
)

test.each([...RENDER_POINTS])(
  "a crash at %s while the owed edit lands resumes to the same file with one more sync commit",
  async (point) => {
    const { a, b } = await heldWithPeerEdit()
    const commitsBefore = (await a.syncCommits()).length
    await a.write("shared.md", note("first\nfrom a\n"))
    await a.restart(crashAt(point))
    await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
    await a.restart()
    await a.engine.runCycle()
    await expectBothEditsOnBoth(a, b)
    expect((await a.syncCommits()).length).toBe(commitsBefore + 1)
  },
  TIMEOUT,
)

test(
  "after a crash between journaling and importing the healing edit, the next cycle journals no second op for the file and both devices agree",
  async () => {
    const { a, b } = await heldWithPeerEdit()
    await a.write("shared.md", note("first\nfrom a\n"))
    await a.restart(crashAt("captured"))
    await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
    expect((await a.engine.journal.pending()).items.filter((item) => item.key === "shared.md")).toHaveLength(1)
    await a.restart()
    const journaled: number[] = []
    const setPending = a.engine.journal.setPending.bind(a.engine.journal)
    a.engine.journal.setPending = async (pending) => {
      journaled.push(pending.items.filter((item) => item.key === "shared.md").length)
      return setPending(pending)
    }
    await a.engine.runCycle()
    expect(journaled.length > 0 && journaled.every((n) => n <= 1)).toBe(true)
    await expectBothEditsOnBoth(a, b)
  },
  TIMEOUT,
)
