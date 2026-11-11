import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import { promisify } from "node:util"
import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { item, publish } from "./received-keys.test-support"

// A file system that keeps both normalization forms (Linux, Windows) is where a second spelling
// could appear; on one that folds them (APFS) these rows hold trivially.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const execFileAsync = promisify(execFile)
const NFD = "re\u0301sume\u0301.md"
const NFC = NFD.normalize("NFC")

const names = async (d: Device): Promise<string[]> =>
  (await readdir(d.repo.root)).filter((n) => n !== ".git" && n !== ".gitkeep").sort()

async function tracked(d: Device): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: d.repo.root,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  })
  return stdout.split("\0").filter((n) => n !== "" && n !== ".gitkeep")
}

test(
  "a received edit to a file whose on-disk name is not NFC lands in that same file and its later edits keep syncing",
  async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a")
    const b = await makeDevice(server, "b")
    devices.push(a, b)
    await a.write(NFD, "v1\n")
    await a.engine.runCycle()
    await b.engine.runCycle()
    expect(await b.read(NFC)).toBe("v1\n")

    await b.write(NFC, "v2\n")
    await b.engine.runCycle()
    expect(await a.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 0 })
    expect(await names(a)).toEqual([NFD])
    expect(await a.read(NFD)).toBe("v2\n")
    expect((await tracked(a)).map((n) => n.normalize("NFC"))).toEqual([NFC])

    await a.write(NFD, "v3\n")
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
    await b.engine.runCycle()
    expect(await b.read(NFC)).toBe("v3\n")
    expect(await a.engine.state()).toMatchObject({ rejectedItems: 0, cycle: null, paused: null })
  },
  GIT_TEST_TIMEOUT,
)

test(
  "a received edit never adds another spelling of a name the device already holds",
  async () => {
    const server = new FakeSyncServer()
    const b = await makeDevice(server, "b")
    devices.push(b)
    await b.write(NFC, "nfc\n")
    await b.write(NFD, "nfd\n")
    const before = await names(b)
    await b.engine.runCycle()
    await publish(server, item(NFC, "from a peer"))
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1 })
    expect(await names(b)).toEqual(before)
    expect(await b.engine.state()).toMatchObject({ cycle: null, paused: null })
  },
  GIT_TEST_TIMEOUT,
)
