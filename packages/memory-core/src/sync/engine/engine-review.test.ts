import { afterEach, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { CrashInjected } from "./engine"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

// Regressions from the #10548 review: a remote create+delete must never wedge a device that never
// had the file (H1), and an edit made between an interrupted cycle and its resume must survive (M1).

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const crashAt = (point: string) => (at: string) => {
  if (at === point) throw new CrashInjected(point)
}

for (const realStore of [false, true]) {
  const store = realStore ? "Loro store" : "fake store"

  test(`${store}: a fresh device receiving a create and a delete of a file it never had keeps syncing`, async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore })
    devices.push(a)
    await a.write("gone.md", "short-lived\n")
    await a.engine.runCycle()
    await a.write("gone.md", null)
    await a.engine.runCycle()
    await a.write("kept.md", "kept\n")
    await a.engine.runCycle()
    const b = await makeDevice(server, "b", undefined, { realStore })
    devices.push(b)
    await b.engine.runCycle()
    expect(await b.read("gone.md")).toBeNull()
    expect(await b.read("kept.md")).toBe("kept\n")
    expect((await b.engine.state()).cycle).toBeNull()
    expect((await b.engine.state()).applied).toBe(3)
    await b.write("from-b.md", "b\n")
    await b.engine.runCycle()
    await a.engine.runCycle()
    expect(await a.read("from-b.md")).toBe("b\n")
  }, GIT_TEST_TIMEOUT)

  test(`${store}: an edit made between a cycle interrupted at merged and its resume reaches both devices`, async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore })
    const b = await makeDevice(server, "b", undefined, { realStore })
    devices.push(a, b)
    await a.write("x.md", "one\n")
    await a.engine.runCycle()
    await b.engine.runCycle()
    await a.write("x.md", "one\nfrom-a\n")
    await a.engine.runCycle()
    await b.restart(crashAt("merged"))
    await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
    await b.write("x.md", "one\nfrom-b-after-crash\n")
    await b.restart()
    await b.engine.runCycle()
    await a.engine.runCycle()
    await b.engine.runCycle()
    const [onA, onB] = [await a.read("x.md"), await b.read("x.md")]
    expect(onA).toBe(onB)
    for (const line of ["one", "from-a", "from-b-after-crash"]) expect(onB).toContain(line)
  }, GIT_TEST_TIMEOUT)
}

// Round 3 (#10548 delta review): a crash in the middle of the render loop, then an edit to a file
// the crashed cycle had already rendered. Compared byte for byte on the Loro store, where a
// re-expressed remote line shows up as a duplicate.
test("Loro store: an edit to a file rendered before a mid-render crash is kept once, with no duplicated remote line", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true })
  const b = await makeDevice(server, "b", undefined, { realStore: true })
  devices.push(a, b)
  await a.write("x.md", "one\n")
  await a.write("y.md", "uno\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.write("x.md", "one\nfrom-a\n")
  await a.write("y.md", "uno\nde-a\n")
  await a.engine.runCycle()
  // x.md renders first (keys are sorted); the crash lands before y.md.
  await b.restart(crashAt("render-key"))
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  expect(await b.read("x.md")).toBe("one\nfrom-a\n")
  expect(await b.read("y.md")).toBe("uno\n")
  await b.write("x.md", "one\nfrom-a\nfrom-b\n")
  await b.restart()
  await b.engine.runCycle()
  await a.engine.runCycle()
  await b.engine.runCycle()
  expect([await a.read("x.md"), await b.read("x.md")]).toEqual(["one\nfrom-a\nfrom-b\n", "one\nfrom-a\nfrom-b\n"])
  expect([await a.read("y.md"), await b.read("y.md")]).toEqual(["uno\nde-a\n", "uno\nde-a\n"])
}, GIT_TEST_TIMEOUT)

test("Loro store: an edit made after a crash between a render's record and its landing is captured against the old text, once", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true })
  const b = await makeDevice(server, "b", undefined, { realStore: true })
  devices.push(a, b)
  await a.write("x.md", "one\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.write("x.md", "one\nfrom-a\n")
  await a.engine.runCycle()
  await b.restart(crashAt("render-intent"))
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  expect(await b.read("x.md")).toBe("one\n")
  await b.write("x.md", "zero\none\n")
  await b.restart()
  await b.engine.runCycle()
  await a.engine.runCycle()
  await b.engine.runCycle()
  expect([await a.read("x.md"), await b.read("x.md")]).toEqual(["zero\none\nfrom-a\n", "zero\none\nfrom-a\n"])
  expect((await b.workingFiles()).filter((k) => k.includes("sync-conflict"))).toEqual([])
}, GIT_TEST_TIMEOUT)

for (const realStore of [false, true]) {
  test.each(["git-commit", "rendered", "committed"])(`${realStore ? "Loro" : "fake"} store: an edit made after a crash at %s, to a file the cycle rendered, keeps the remote line and the edit`, async (point) => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore })
    const b = await makeDevice(server, "b", undefined, { realStore })
    devices.push(a, b)
    await b.write("a.md", "remote\n")
    await b.engine.runCycle()
    await a.restart(crashAt(point))
    await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
    expect(await a.read("a.md")).toBe("remote\n")
    await a.write("a.md", "remote\nlocal\n")
    await a.restart()
    await a.engine.runCycle()
    await b.engine.runCycle()
    await a.engine.runCycle()
    const expected = "remote\nlocal\n"
    // The fake store renders a line set (sorted); the Loro store must keep the order byte for byte.
    const shape = (text: string | null) => (realStore ? text : (text ?? "").split("\n").filter((l) => l !== "").sort().join("\n"))
    expect([shape(await a.read("a.md")), shape(await b.read("a.md"))]).toEqual([shape(expected), shape(expected)])
  }, GIT_TEST_TIMEOUT)
}

// Round 4 (#10548): a second crash inside the resumed render must not drop the records the first
// run wrote, or a later edit to an already-rendered file is captured against a stale baseline.
const crashAtNth = (point: string, nth: number) => {
  let seen = 0
  return (at: string) => {
    if (at === point && (seen += 1) === nth) throw new CrashInjected(`${point}#${nth}`)
  }
}

test("Loro store: a crash during the resumed render keeps the first run's render records; a later edit is kept once", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true })
  const b = await makeDevice(server, "b", undefined, { realStore: true })
  devices.push(a, b)
  await a.write("x.md", "one\n")
  await a.write("y.md", "uno\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.write("x.md", "one\nfrom-a\n")
  await a.write("y.md", "uno\nde-a\n")
  await a.engine.runCycle()
  // First run: x lands, the crash comes before y. The resume crashes again after recording y's render
  // but before it lands, so the journal holds x's landed record and y's unlanded one.
  await b.restart(crashAtNth("render-key", 1))
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await b.restart(crashAtNth("render-intent", 1))
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  expect([await b.read("x.md"), await b.read("y.md")]).toEqual(["one\nfrom-a\n", "uno\n"])
  await b.write("x.md", "one\nfrom-a\nfrom-b\n")
  await b.write("y.md", "zero\nuno\n")
  await b.restart()
  await b.engine.runCycle()
  await a.engine.runCycle()
  await b.engine.runCycle()
  expect([await a.read("x.md"), await b.read("x.md")]).toEqual(["one\nfrom-a\nfrom-b\n", "one\nfrom-a\nfrom-b\n"])
  expect([await a.read("y.md"), await b.read("y.md")]).toEqual(["zero\nuno\nde-a\n", "zero\nuno\nde-a\n"])
}, GIT_TEST_TIMEOUT)

test("Loro store: crashes at record, then after the edit is captured and persisted, still converge exactly once", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true })
  const b = await makeDevice(server, "b", undefined, { realStore: true })
  devices.push(a, b)
  await a.write("x.md", "one\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.write("x.md", "one\nfrom-a\n")
  await a.engine.runCycle()
  await b.restart(crashAtNth("render-intent", 1))
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await b.write("x.md", "zero\none\n")
  await b.restart(crashAtNth("persisted", 1))
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await b.restart(crashAtNth("render-key", 1))
  await b.engine.runCycle().catch((error: unknown) => {
    if (!(error instanceof CrashInjected)) throw error
  })
  await b.restart()
  await b.engine.runCycle()
  await a.engine.runCycle()
  await b.engine.runCycle()
  expect([await a.read("x.md"), await b.read("x.md")]).toEqual(["zero\none\nfrom-a\n", "zero\none\nfrom-a\n"])
  expect((await b.workingFiles()).filter((k) => k.includes("sync-conflict") || k.includes(".staged"))).toEqual([])
}, GIT_TEST_TIMEOUT)

// A deleted memory re-created by a person (found by the Loro delete fuzz): capture threw
// CaptureBaselineError on every cycle, wedging the device.
for (const content of ["again\n", "one\n"]) {
  test(`Loro store: a file re-created after a local delete syncs (${content === "one\n" ? "same" : "new"} content)`, async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true })
    const b = await makeDevice(server, "b", undefined, { realStore: true })
    devices.push(a, b)
    await a.write("x.md", "one\n")
    await a.engine.runCycle()
    await b.engine.runCycle()
    await a.write("x.md", null)
    await a.engine.runCycle()
    await b.engine.runCycle()
    expect(await b.read("x.md")).toBeNull()
    await a.write("x.md", content)
    await a.engine.runCycle()
    await b.engine.runCycle()
    await a.engine.runCycle()
    expect([await a.read("x.md"), await b.read("x.md")]).toEqual([content, content])
  }, GIT_TEST_TIMEOUT)

  test(`Loro store: a file re-created after a remote delete syncs (${content === "one\n" ? "same" : "new"} content)`, async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true })
    const b = await makeDevice(server, "b", undefined, { realStore: true })
    devices.push(a, b)
    await a.write("x.md", "one\n")
    await a.engine.runCycle()
    await b.engine.runCycle()
    await a.write("x.md", null)
    await a.engine.runCycle()
    await b.engine.runCycle()
    await b.write("x.md", content)
    await b.engine.runCycle()
    await a.engine.runCycle()
    await b.engine.runCycle()
    expect([await a.read("x.md"), await b.read("x.md")]).toEqual([content, content])
  }, GIT_TEST_TIMEOUT)
}

// L1 (#10548 round-4 review): a crash at `staged` leaves a .staged file with no record; a later
// delete record reusing that seq must not read the leftover as "landed".
test("Loro store: a leftover staged file from a crashed step does not make a later delete look landed", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true })
  const b = await makeDevice(server, "b", undefined, { realStore: true })
  devices.push(a, b)
  await a.write("x.md", "one\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.write("x.md", null)
  await a.engine.runCycle()
  await b.restart(crashAt("merged"))
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  const cycle = (await b.engine.state()).cycle
  if (cycle === null) throw new Error("no cycle in flight")
  // What a crash at `staged` of an earlier attempt leaves: a staged file with no record.
  const renders = join(b.repo.gitDir, "omo-sync", "renders", cycle.id)
  await mkdir(renders, { recursive: true })
  await writeFile(join(renders, "00000001.staged"), "stale\n")
  await b.restart(crashAt("render-intent"))
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await b.restart()
  await b.engine.runCycle()
  await a.engine.runCycle()
  expect([await a.read("x.md"), await b.read("x.md")]).toEqual([null, null])
}, GIT_TEST_TIMEOUT)
