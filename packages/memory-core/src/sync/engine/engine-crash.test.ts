import { afterEach, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

import { createNodeGitExec } from "../../git/exec"
import { StrandedGitLockError } from "../../git/repo-lock-sweep"

import { CrashInjected, INBOUND_POINTS, OUTBOUND_POINTS } from "./engine"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const execFileAsync = promisify(execFile)
// The NFD spelling of "résumé.md"; its item key is the NFC spelling.
const NFD_DELETE = "re\u0301sume\u0301.md"
const NFC_DELETE = NFD_DELETE.normalize("NFC")

async function tracked(d: Device): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: d.repo.root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } })
  return stdout.split("\0").filter((n) => n !== "" && n !== ".gitkeep")
}

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const crashAt = (point: string) => (at: string) => {
  if (at === point) throw new CrashInjected(point)
}

async function world() {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  devices.push(a)
  return { server, a }
}

test.each([...INBOUND_POINTS])("a receive crash at %s resumes with every line, one commit, no temp file", async (point) => {
  const { server, a } = await world()
  await a.write("one.md", "one\n")
  await a.engine.runCycle()
  await a.write("two.md", "two\n")
  await a.engine.runCycle()
  const b = await makeDevice(server, "b", crashAt(point))
  devices.push(b)
  await b.write("local.md", "kept\n")
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await b.restart()
  await b.engine.runCycle()
  expect([await b.read("one.md"), await b.read("two.md"), await b.read("local.md")]).toEqual(["one\n", "two\n", "kept\n"])
  expect(await b.syncCommits()).toEqual(["1-2"])
  expect(await b.workingTempFiles()).toEqual([])
  expect((await b.engine.state()).applied).toBeGreaterThanOrEqual(2)
  await a.engine.runCycle()
  expect(await a.read("local.md")).toBe("kept\n")
}, GIT_TEST_TIMEOUT)

test.each([...OUTBOUND_POINTS])("a push crash at %s resumes with the batch appended exactly once", async (point) => {
  const { server, a } = await world()
  await a.restart(crashAt(point))
  await a.write("mine.md", "edit\n")
  await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await a.restart()
  await a.engine.runCycle()
  expect(server.entries).toHaveLength(1)
  const b = await makeDevice(server, "b")
  devices.push(b)
  await b.engine.runCycle()
  expect(await b.read("mine.md")).toBe("edit\n")
  expect((await a.engine.state()).applied).toBe(1)
  expect(await a.engine.runCycle()).toMatchObject({ pushed: false, applied: 0 })
}, GIT_TEST_TIMEOUT)

test("a crash after the git commit but before `committed` is reconciled from HEAD, not re-committed", async () => {
  const { server, a } = await world()
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  const b = await makeDevice(server, "b", crashAt("git-commit"))
  devices.push(b)
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  expect(await b.syncCommits()).toEqual(["1-1"])
  expect((await b.engine.state()).cycle?.stage).toBe("rendered")
  await b.restart()
  await b.engine.runCycle()
  expect(await b.syncCommits()).toEqual(["1-1"])
  expect(await b.engine.state()).toMatchObject({ applied: 1, cycle: null })
}, GIT_TEST_TIMEOUT)

test("an agent commit landing between `rendered` and `committed` does not fool reconciliation", async () => {
  const { server, a } = await world()
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  const b = await makeDevice(server, "b", crashAt("rendered"))
  devices.push(b)
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await b.write("agent.md", "agent\n")
  await b.repo.commit(["agent.md"], "agent: a memory write")
  await b.restart()
  await b.engine.runCycle()
  expect(await b.syncCommits()).toEqual(["1-1"])
  expect([await b.read("x.md"), await b.read("agent.md")]).toEqual(["x\n", "agent\n"])
}, GIT_TEST_TIMEOUT)

test("a crash after a delete of an NFD-named file has landed resumes staging the delete at the tracked spelling (#12158 item 2)", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  // given: A tracks the file at its NFD on-disk spelling; B holds the same key at NFC.
  await a.write(NFD_DELETE, "v1\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  expect(await b.read(NFC_DELETE)).toBe("v1\n")
  // A only tracks the file once it receives a cycle that renders it (its own push leaves it dirty).
  await b.write(NFC_DELETE, "v2\n")
  await b.engine.runCycle()
  await a.engine.runCycle()
  expect(await tracked(a)).toContain(NFD_DELETE)
  // when: B deletes the file and A receives the delete, crashing right after the delete lands.
  await b.write(NFC_DELETE, null)
  await b.engine.runCycle()
  await a.restart(crashAt("render-key"))
  await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  // The delete has landed (the working file is moved aside) but nothing is staged yet.
  expect(await a.read(NFD_DELETE)).toBeNull()
  expect(await tracked(a)).toContain(NFD_DELETE)
  await a.restart()
  await a.engine.runCycle()
  // then: the resumed cycle stages the delete at the spelling HEAD tracked, not the NFC key.
  expect(await a.read(NFD_DELETE)).toBeNull()
  expect(await a.read(NFC_DELETE)).toBeNull()
  expect(await tracked(a)).not.toContain(NFD_DELETE)
  const status = await createNodeGitExec().run(["status", "--porcelain"], { cwd: a.repo.root, timeoutMs: 20_000 })
  expect(status.stdout).toBe("")
  expect(await a.syncCommits()).toEqual(["3-3", "2-2"])
  expect((await a.engine.state()).cycle).toBeNull()
  expect(await a.renderJournals()).toEqual([])
}, GIT_TEST_TIMEOUT)

test("a cycle cut short by a stranded index lock after its sync commit landed leaves a clean index once the lock is gone (omo #10637)", async () => {
  const { server, a } = await world()
  const b = await makeDevice(server, "b")
  devices.push(b)
  await a.write("one.md", "one\n")
  await a.engine.runCycle()
  const lock = join(b.repo.gitDir, "index.lock")
  await writeFile(lock, "")
  const failure = await b.engine.runCycle().then(() => null, (error: unknown) => error)
  expect(failure).toBeInstanceOf(StrandedGitLockError)
  await rm(lock)
  await b.engine.runCycle()
  const status = await createNodeGitExec().run(["status", "--porcelain"], { cwd: b.repo.root, timeoutMs: 20_000 })
  expect(status.stdout).toBe("")
  expect(await b.read("one.md")).toBe("one\n")
  expect(await b.syncCommits()).toHaveLength(1)
}, GIT_TEST_TIMEOUT)
