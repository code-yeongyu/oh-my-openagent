import { afterEach, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

// #13720: a remote-less repository moves from the per-device `local:` space an older build minted to
// the account default space. The account feed carries every space, and the journal's cursor, outbox and
// item docs belong to the space they were built in, so the move must start the repository over in the
// new space: pull that space from the start and push its own working tree into it.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const note = (body: string) => `---\ndescription: space move note\n---\n${body}`
const LEGACY = "legacy-local-space"
const DEFAULT = "account-default-space"

async function devicesBeforeTheMove(): Promise<{ a: Device; b: Device }> {
  const server = new FakeSyncServer()
  const b = await makeDevice(server, "b", undefined, { realStore: true, space: DEFAULT })
  const a = await makeDevice(server, "a", undefined, { realStore: true, space: LEGACY })
  devices.push(a, b)
  await b.write("from-b.md", note("written on b\n"))
  await b.engine.runCycle()
  await a.write("from-a.md", note("written on a\n"))
  await a.engine.runCycle()
  expect(await a.read("from-b.md")).toBeNull()
  return { a, b }
}

async function settle(a: Device, b: Device): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await a.engine.runCycle()
    await b.engine.runCycle()
  }
}

test(
  "#given a repository whose journal names the legacy space #when it moves to the default space #then its journal is retired and memory crosses both ways",
  async () => {
    const { a, b } = await devicesBeforeTheMove()
    await a.restart()
    await a.engine.runCycle()
    expect(await a.retiredJournals()).toHaveLength(0)

    await a.restart(undefined, { space: DEFAULT })
    await settle(a, b)

    expect(await a.read("from-b.md")).toBe(note("written on b\n"))
    expect(await b.read("from-a.md")).toBe(note("written on a\n"))
    expect(await a.retiredJournals()).toHaveLength(1)
  },
  GIT_TEST_TIMEOUT,
)

test(
  "#given a journal an older build wrote with no space #when the repository moves off its legacy space #then that journal is retired too",
  async () => {
    const { a, b } = await devicesBeforeTheMove()
    const statePath = join(a.repo.root, ".git", "omo-sync", "state.json")
    const { space: _recorded, ...olderBuildState } = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >
    await writeFile(statePath, JSON.stringify(olderBuildState))

    await a.restart(undefined, { space: DEFAULT, legacySpace: LEGACY })
    await settle(a, b)

    expect(await a.read("from-b.md")).toBe(note("written on b\n"))
    expect(await b.read("from-a.md")).toBe(note("written on a\n"))
    expect(await a.retiredJournals()).toHaveLength(1)
  },
  GIT_TEST_TIMEOUT,
)
