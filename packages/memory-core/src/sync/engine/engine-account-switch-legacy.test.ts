import { afterEach, expect, test } from "bun:test"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { type Device, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const note = (body: string) => `---\ndescription: legacy journal note\n---\n${body}`

async function settle(...ds: Device[]): Promise<void> {
  for (let round = 0; round < 3; round += 1) for (const d of ds) await d.engine.runCycle()
}

async function legacyDeviceOnA(serverA: FakeSyncServer): Promise<Device> {
  const d = await makeDevice(serverA, "d", undefined, { realStore: true, account: "acc_a" })
  devices.push(d)
  for (const name of ["one", "two"]) {
    await d.write(`${name}.md`, note(`${name} on a\n`))
    await d.engine.runCycle()
  }
  const statePath = join(d.repo.root, ".git", "omo-sync", "state.json")
  const { account: _owner, ...olderBuild } = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>
  await writeFile(statePath, JSON.stringify(olderBuild))
  return d
}

test("#given a legacy journal from account A #when the device signs in to B #then B receives nothing of A and A's files are set aside, not deleted", async () => {
  const serverA = new FakeSyncServer()
  const serverB = new FakeSyncServer()
  const d = await legacyDeviceOnA(serverA)
  const e = await makeDevice(serverB, "e", undefined, { realStore: true, account: "acc_b" })
  devices.push(e)

  await d.restart(undefined, undefined, { server: serverB, account: "acc_b" })
  await settle(d, e)

  expect(serverB.head).toBe(0)
  expect(serverB.appends).toEqual([])
  expect(await d.read("one.md")).toBeNull()
  const git = await readdir(join(d.repo.root, ".git"))
  expect(git.some((name) => name.startsWith("omo-sync.account-") && name.endsWith(".tree"))).toBe(true)
})

test("#given a legacy journal from the same account #when the device signs in to it #then it is adopted with no re-upload", async () => {
  const serverA = new FakeSyncServer()
  const d = await legacyDeviceOnA(serverA)
  const head = serverA.head
  const appends = serverA.appends.length

  await d.restart(undefined, undefined, { server: serverA, account: "acc_a" })
  await settle(d)

  expect(serverA.head).toBe(head)
  expect(serverA.appends.length).toBe(appends)
  expect(await d.read("one.md")).toBe(note("one on a\n"))
})

test("#given a legacy journal #when the ownership proof cannot reach the service #then nothing is uploaded or set aside until a later cycle proves it", async () => {
  const serverA = new FakeSyncServer()
  const d = await legacyDeviceOnA(serverA)
  const head = serverA.head
  serverA.unreachable.add("device:d")

  await d.restart(undefined, undefined, { server: serverA, account: "acc_a" })
  await expect(d.engine.runCycle()).rejects.toMatchObject({ name: "OwnershipUnprovenError" })
  expect(await d.read("one.md")).toBe(note("one on a\n"))
  expect(serverA.head).toBe(head)
  expect((await readdir(join(d.repo.root, ".git"))).filter((name) => name.startsWith("omo-sync.account-"))).toEqual([])

  serverA.unreachable.delete("device:d")
  await settle(d)
  expect(await d.read("one.md")).toBe(note("one on a\n"))
  expect(serverA.head).toBe(head)
})

test("#given A's legacy memory was set aside under B #when A signs in again and its server proves the journal #then A's notes come back and B still has none", async () => {
  const serverA = new FakeSyncServer()
  const serverB = new FakeSyncServer()
  const d = await legacyDeviceOnA(serverA)
  await d.restart(undefined, undefined, { server: serverB, account: "acc_b" })
  await settle(d)
  expect(await d.read("one.md")).toBeNull()

  await d.restart(undefined, undefined, { server: serverA, account: "acc_a" })
  await settle(d)
  expect(await d.read("one.md")).toBe(note("one on a\n"))
  expect(await d.read("two.md")).toBe(note("two on a\n"))
  expect(serverB.head).toBe(0)
})

async function legacyJournal(
  d: Device,
): Promise<{ applied: Record<string, { seq: number; digest: string }>; state: string }> {
  const dir = join(d.repo.root, ".git", "omo-sync")
  return {
    applied: JSON.parse(await readFile(join(dir, "applied.json"), "utf8")) as Record<
      string,
      { seq: number; digest: string }
    >,
    state: join(dir, "state.json"),
  }
}

test("#given a legacy journal that last applied a snapshot #when the device signs in with the service reachable #then it stays undecided: nothing adopted, set aside or uploaded", async () => {
  const serverA = new FakeSyncServer()
  const d = await legacyDeviceOnA(serverA)
  const head = serverA.head
  serverA.compact(head, new TextEncoder().encode(`snapshot through ${head}`))
  const dir = join(d.repo.root, ".git", "omo-sync")
  await writeFile(
    join(dir, "applied.json"),
    JSON.stringify({ [`snapshot:${head}`]: { seq: head, digest: serverA.snapshot?.digest ?? "" } }),
  )
  await d.write("unsent.md", note("edited before the upgrade, never pushed\n"))

  await d.restart(undefined, undefined, { server: serverA, account: "acc_a" })
  await expect(d.engine.runCycle()).rejects.toMatchObject({ name: "OwnershipUndecidedError" })

  expect(await d.engine.status()).toMatchObject({ kind: "failing", failure: { kind: "ownership_undecided" } })
  expect(serverA.head).toBe(head)
  expect(await d.read("one.md")).toBe(note("one on a\n"))
  expect(await d.read("unsent.md")).toBe(note("edited before the upgrade, never pushed\n"))
  expect((await readdir(join(d.repo.root, ".git"))).filter((name) => name.startsWith("omo-sync.account-"))).toEqual([])
  expect(JSON.parse(await readFile(join(dir, "state.json"), "utf8"))).not.toHaveProperty("account")
})

test("#given a legacy journal that knows a seq only as a snapshot #when the signed-in account's server still keeps that row #then the journal is another account's: set aside, nothing uploaded", async () => {
  const serverA = new FakeSyncServer()
  const serverB = new FakeSyncServer()
  const d = await legacyDeviceOnA(serverA)
  const other = await makeDevice(serverB, "e", undefined, { realStore: true, account: "acc_b" })
  devices.push(other)
  for (const name of ["b1", "b2"]) {
    await other.write(`${name}.md`, note(`${name} on b\n`))
    await other.engine.runCycle()
  }
  const headB = serverB.head
  const dir = join(d.repo.root, ".git", "omo-sync")
  const { applied } = JSON.parse(await readFile(join(dir, "state.json"), "utf8")) as { applied: number }
  expect(headB).toBeGreaterThanOrEqual(applied)
  await writeFile(join(dir, "applied.json"), JSON.stringify({ [`snapshot:${applied}`]: { seq: applied, digest: "" } }))

  await d.restart(undefined, undefined, { server: serverB, account: "acc_b" })
  await settle(d)

  expect(serverB.head).toBe(headB)
  expect(await d.read("one.md")).toBeNull()
  expect((await readdir(join(d.repo.root, ".git"))).some((name) => name.startsWith("omo-sync.account-"))).toBe(true)
})

test("#given a legacy journal whose records the server compacted away #when the device signs in #then it stays undecided: nothing adopted, set aside or uploaded", async () => {
  const serverA = new FakeSyncServer()
  const d = await legacyDeviceOnA(serverA)
  const head = serverA.head
  expect(Object.values((await legacyJournal(d)).applied).some((r) => r.seq === head)).toBe(true)
  serverA.compact(head, new TextEncoder().encode(`snapshot through ${head}`))
  await d.write("unsent.md", note("edited before the upgrade, never pushed\n"))

  await d.restart(undefined, undefined, { server: serverA, account: "acc_a" })
  await expect(d.engine.runCycle()).rejects.toMatchObject({ name: "OwnershipUndecidedError" })
  await d.engine.runCycle().catch(() => undefined)

  expect(await d.engine.status()).toMatchObject({ kind: "failing", failure: { kind: "ownership_undecided" } })
  expect(serverA.head).toBe(head)
  expect(await d.read("one.md")).toBe(note("one on a\n"))
  expect((await readdir(join(d.repo.root, ".git"))).filter((name) => name.startsWith("omo-sync.account-"))).toEqual([])
  expect(JSON.parse(await readFile((await legacyJournal(d)).state, "utf8"))).not.toHaveProperty("account")
})
