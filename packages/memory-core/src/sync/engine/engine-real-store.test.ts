import { afterEach, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { CrashInjected } from "./engine"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const note = (body: string) => `---\ndescription: shared note\n---\n${body}`

test("two engines on the production Loro item store converge, keeping both sides' edits to one note", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true })
  const b = await makeDevice(server, "b", undefined, { realStore: true })
  devices.push(a, b)
  await a.write("note.md", note("first line\n"))
  await a.engine.runCycle()
  await b.engine.runCycle()
  expect(await b.read("note.md")).toBe(note("first line\n"))
  await a.write("note.md", note("first line\nfrom a\n"))
  await b.write("note.md", note("from b\nfirst line\n"))
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.engine.runCycle()
  const [onA, onB] = [await a.read("note.md"), await b.read("note.md")]
  expect(onA).toBe(onB)
  for (const piece of ["first line", "from a", "from b"]) expect(onA).toContain(piece)
  expect(await b.syncCommits()).toHaveLength(2)
}, GIT_TEST_TIMEOUT)

// PR #12295 review: the line diff runs only when every other member advertises it. Both devices replace
// the first line of a 2-line note from one baseline after each has pushed once.
async function sameLineEdit(aOptions: { advertise: boolean; census?: readonly string[] }, bOptions: { advertise: boolean; census?: readonly string[] }) {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true, ...aOptions })
  const b = await makeDevice(server, "b", undefined, { realStore: true, ...bOptions })
  devices.push(a, b)
  await a.write("note.md", note("the meeting moved to Monday\nkeep me\n"))
  await a.engine.runCycle()
  await b.engine.runCycle()
  await b.write("other.md", note("b was here\n"))
  await b.engine.runCycle()
  await a.engine.runCycle()
  await a.write("note.md", note("the meeting moved to Tuesday\nkeep me\n"))
  await b.write("note.md", note("the meeting moved to Thursday\nkeep me\n"))
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.engine.runCycle()
  const [onA, onB] = [await a.read("note.md"), await b.read("note.md")]
  expect(onA).toBe(onB)
  return (onA ?? "").slice(note("").length).split("\n")
}

test("a mixed account keeps the character merge: the untouched line survives whole", async () => {
  // a runs this build and knows b is a member; b is emulated as an older build (no marker, no census).
  const lines = await sameLineEdit({ advertise: true, census: ["device:b"] }, { advertise: false })
  expect(lines.filter((line) => line === "keep me")).toHaveLength(1)
  const body = lines.join("\n")
  for (const token of ["Tues", "Thurs"]) expect(body).toContain(token)
}, GIT_TEST_TIMEOUT)

test("an all-new account merges the same edit as two whole lines", async () => {
  const lines = await sameLineEdit({ advertise: true, census: ["device:b"] }, { advertise: true, census: ["device:a"] })
  expect(lines.sort()).toEqual(["", "keep me", "the meeting moved to Thursday", "the meeting moved to Tuesday"])
}, GIT_TEST_TIMEOUT)

test("an advertisement survives a crash right after its batch is journaled verified", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true, advertise: true, census: ["device:b"] })
  let crashed = false
  const b = await makeDevice(server, "b", (point) => {
    if (point === "verified" && !crashed) {
      crashed = true
      throw new CrashInjected(point)
    }
  }, { realStore: true, advertise: true, census: ["device:a"] })
  devices.push(a, b)
  await a.write("note.md", note("seed\n"))
  await a.engine.runCycle()
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await b.restart()
  await b.engine.runCycle()
  const state: unknown = JSON.parse(await readFile(join(b.repo.gitDir, "omo-sync", "state.json"), "utf8"))
  expect(state).toMatchObject({ heard: { "device:a": { bodyLine: true } } })
}, GIT_TEST_TIMEOUT)
