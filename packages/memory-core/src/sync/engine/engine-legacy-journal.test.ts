import { afterEach, expect, test } from "bun:test"
import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { CrashInjected } from "./engine"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

// #10588 item 2 (journal storage migration): pre-merge builds of #10548 kept a cycle's rendered
// text inline in state.json (`texts` from stage rendered on, `progress` at stage merged) and had no
// render journal. A device stopped mid-cycle on such a build must adopt those renders as baselines
// on resume, or its next capture re-pushes the remote change as its own edit.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const crashAt = (point: string) => (at: string) => {
  if (at === point) throw new CrashInjected(point)
}

type LegacyShape = (rendered: string) => Record<string, unknown>

const LEGACY_SHAPES: readonly (readonly [string, string, LegacyShape])[] = [
  ["committed", "committed", (rendered) => ({ stage: "committed", texts: { "x.md": rendered } })],
  ["rendered", "rendered", (rendered) => ({ stage: "rendered", texts: { "x.md": rendered } })],
  ["merged with a landed render", "render-key", (rendered) => ({ stage: "merged", texts: {}, progress: { "x.md": { text: rendered, done: true } } })],
  ["merged with an unconfirmed render", "render-key", (rendered) => ({ stage: "merged", texts: {}, progress: { "x.md": { text: rendered, done: false } } })],
]

async function rewriteAsLegacy(device: Device, shape: Record<string, unknown>): Promise<void> {
  const statePath = join(device.repo.gitDir, "omo-sync", "state.json")
  const state: { cycle: Record<string, unknown> | null } = JSON.parse(await readFile(statePath, "utf8"))
  if (state.cycle === null) throw new Error("no cycle in flight")
  await rm(join(device.repo.gitDir, "omo-sync", "renders"), { recursive: true, force: true })
  await writeFile(statePath, `${JSON.stringify({ ...state, cycle: { ...state.cycle, ...shape } })}\n`)
}

async function baselineText(device: Device, key: string): Promise<string | null | undefined> {
  const index: Record<string, { text: string | null }> = JSON.parse(await readFile(join(device.repo.gitDir, "omo-sync", "crdt", "baselines.json"), "utf8"))
  return index[key]?.text
}

for (const realStore of [false, true]) {
  const store = realStore ? "Loro store" : "fake store"
  for (const [label, point, shape] of LEGACY_SHAPES) {
    test(`${store}: a cycle journaled by an earlier build at ${label} resumes without re-pushing the remote change`, async () => {
      const server = new FakeSyncServer()
      const a = await makeDevice(server, "a", undefined, { realStore })
      const b = await makeDevice(server, "b", undefined, { realStore })
      devices.push(a, b)
      await a.write("x.md", "one\n")
      await a.engine.runCycle()
      await b.engine.runCycle()
      await a.write("x.md", "one\ntwo\n")
      await a.engine.runCycle()
      await b.restart(crashAt(point))
      await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
      await rewriteAsLegacy(b, shape("one\ntwo\n"))
      const entries = server.entries.length

      await b.restart()
      await b.engine.runCycle()
      if (realStore) expect(await baselineText(b, "x.md")).toBe("one\ntwo\n")
      await b.engine.runCycle()

      expect(server.entries.length).toBe(entries)
      expect(await b.read("x.md")).toBe("one\ntwo\n")
      expect((await b.engine.state()).cycle).toBeNull()
    }, GIT_TEST_TIMEOUT)
  }
}

// An unconfirmed render followed by a local edit is left out: with no render journal, a working file
// that differs from the render cannot say whether the render landed, so the old baseline is kept
// (adopting a render that never landed would delete the remote change instead of duplicating it).
for (const [label, point, shape] of LEGACY_SHAPES.filter(([label]) => !label.includes("unconfirmed"))) {
  test(`Loro store: an edit made after an earlier build stopped at ${label} is pushed as exactly that edit`, async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true })
    const b = await makeDevice(server, "b", undefined, { realStore: true })
    devices.push(a, b)
    await a.write("x.md", "one\n")
    await a.engine.runCycle()
    await b.engine.runCycle()
    await a.write("x.md", "one\ntwo\n")
    await a.engine.runCycle()
    await b.restart(crashAt(point))
    await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
    await rewriteAsLegacy(b, shape("one\ntwo\n"))
    await b.write("x.md", "one\ntwo\nthree\n")

    await b.restart()
    await b.engine.runCycle()
    await b.engine.runCycle()
    await a.engine.runCycle()

    expect([await a.read("x.md"), await b.read("x.md")]).toEqual(["one\ntwo\nthree\n", "one\ntwo\nthree\n"])
  }, GIT_TEST_TIMEOUT)
}

for (const realStore of [false, true]) {
  test(`${realStore ? "Loro store" : "fake store"}: a legacy render of a key the store never knew creates no item (#10620)`, async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore })
    const b = await makeDevice(server, "b", undefined, { realStore })
    devices.push(a, b)
    await a.write("x.md", "one\n")
    await a.engine.runCycle()
    await b.engine.runCycle()
    await a.write("x.md", "one\ntwo\n")
    await a.engine.runCycle()
    await b.restart(crashAt("committed"))
    await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
    await rewriteAsLegacy(b, { stage: "committed", texts: { "x.md": "one\ntwo\n", "ghost.md": null } })

    await b.restart()
    await b.engine.runCycle()

    expect(b.store.keys()).not.toContain("ghost.md")
    expect(await b.read("x.md")).toBe("one\ntwo\n")
  }, GIT_TEST_TIMEOUT)
}
