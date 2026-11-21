import { afterEach, expect, test } from "bun:test"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { type Device, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { DECISION_FILE, decideOwnership, readUndecided } from "./ownership-decision"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const note = (body: string) => `---\ndescription: ownership decision note\n---\n${body}`

async function settle(d: Device): Promise<void> {
  for (let round = 0; round < 3; round += 1) await d.engine.runCycle()
}

/** D synced two notes on A with an older build whose journal kept no applied index, then edited one note offline. */
async function undecidedDevice(): Promise<{
  d: Device
  server: FakeSyncServer
  gitDir: string
  head: number
  files: number
}> {
  const server = new FakeSyncServer()
  const d = await makeDevice(server, "d", undefined, { realStore: true, account: "acc_a" })
  devices.push(d)
  for (const name of ["one", "two"]) {
    await d.write(`${name}.md`, note(`${name} on a\n`))
    await d.engine.runCycle()
  }
  const gitDir = join(d.repo.root, ".git")
  const statePath = join(gitDir, "omo-sync", "state.json")
  const { account: _owner, ...olderBuild } = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>
  await writeFile(statePath, JSON.stringify(olderBuild))
  await writeFile(join(gitDir, "omo-sync", "applied.json"), "{}")
  const head = server.head
  await d.write("unsent.md", note("edited before the upgrade, never pushed\n"))
  await d.restart(undefined, undefined, { server, account: "acc_a" })
  await expect(d.engine.runCycle()).rejects.toMatchObject({ name: "OwnershipUndecidedError" })
  const files = (await readUndecided(gitDir))?.files ?? 0
  return { d, server, gitDir, head, files }
}

test("#given memory sync cannot tell whose memory this is #when it waits #then its notice names the signed-in account and the files a use would upload", async () => {
  const { d, gitDir } = await undecidedDevice()
  const before = (await readUndecided(gitDir))?.files ?? 0
  await d.write("later.md", note("written while undecided\n"))
  await expect(d.engine.runCycle()).rejects.toMatchObject({ name: "OwnershipUndecidedError" })

  expect(before).toBeGreaterThanOrEqual(3)
  expect(await readUndecided(gitDir)).toMatchObject({ account: "acc_a", files: before + 1 })
})

test("#given the person confirmed using the memory with this account #when the next cycle runs #then every owned file is uploaded to it and sync resumes", async () => {
  const { d, server, gitDir, head, files } = await undecidedDevice()

  expect(await decideOwnership(gitDir, "acc_a", "use", files)).toEqual({ kind: "recorded" })
  await settle(d)

  expect(server.head).toBeGreaterThan(head)
  expect((await d.engine.status()).kind).not.toBe("failing")
  expect(await readUndecided(gitDir)).toBeNull()
  const peer = await makeDevice(server, "p", undefined, { realStore: true, account: "acc_a" })
  devices.push(peer)
  await settle(peer)
  expect(await peer.read("unsent.md")).toBe(note("edited before the upgrade, never pushed\n"))
})

test("#given a use confirmed for fewer files than are now on disk #when it is recorded or applied #then nothing is uploaded and the person is asked again with the new count", async () => {
  const { d, server, gitDir, head, files } = await undecidedDevice()

  expect(await decideOwnership(gitDir, "acc_a", "use", files - 1)).toEqual({ kind: "changed", files })
  expect(await decideOwnership(gitDir, "acc_a", "use", files)).toEqual({ kind: "recorded" })
  await d.write("later.md", note("written after the person confirmed\n"))
  await expect(d.engine.runCycle()).rejects.toMatchObject({ name: "OwnershipUndecidedError" })

  expect(server.head).toBe(head)
  expect(await readUndecided(gitDir)).toMatchObject({ account: "acc_a", files: files + 1 })
})

test("#given the person set the memory aside #when the next cycle runs #then it is parked, nothing is uploaded and sync resumes for this account", async () => {
  const { d, server, gitDir, head } = await undecidedDevice()

  expect(await decideOwnership(gitDir, "acc_a", "set_aside", 0)).toEqual({ kind: "recorded" })
  await settle(d)

  expect(server.head).toBe(head)
  expect((await d.engine.status()).kind).not.toBe("failing")
  expect((await readdir(gitDir)).some((name) => name.startsWith("omo-sync.account-"))).toBe(true)
  expect(await d.read("unsent.md")).toBeNull()
})

test("#given a decision recorded for another account #when this account's engine runs #then it is never applied", async () => {
  const { d, server, gitDir, head, files } = await undecidedDevice()

  expect(await decideOwnership(gitDir, "acc_b", "use", files)).toEqual({ kind: "other_account", account: "acc_a" })
  await writeFile(join(gitDir, DECISION_FILE), JSON.stringify({ account: "acc_b", decision: "use", files }))
  await expect(d.engine.runCycle()).rejects.toMatchObject({ name: "OwnershipUndecidedError" })

  expect(server.head).toBe(head)
  expect((await readdir(gitDir)).includes(DECISION_FILE)).toBe(false)
})

test("#given memory sync is not waiting on a decision #when one is recorded #then it is refused", async () => {
  const server = new FakeSyncServer()
  const d = await makeDevice(server, "d", undefined, { realStore: true, account: "acc_a" })
  devices.push(d)
  await d.write("one.md", note("one on a\n"))
  await d.engine.runCycle()

  expect(await decideOwnership(join(d.repo.root, ".git"), "acc_a", "use", 1)).toEqual({ kind: "not_undecided" })
})
