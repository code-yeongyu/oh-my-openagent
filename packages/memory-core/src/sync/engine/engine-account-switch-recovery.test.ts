import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { type Device, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

// #14481 review r1 M1 and r2 M2: an account switch interrupted part way through is finished at the next start,
// whichever account signs in then, including over the empty journal dir production recreates before the engine loads.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const note = (body: string) => `---\ndescription: account switch recovery note\n---\n${body}`
const tag = (account: string) => createHash("sha256").update(account, "utf8").digest("hex").slice(0, 16)

async function settle(...ds: Device[]): Promise<void> {
  for (let round = 0; round < 3; round += 1) for (const d of ds) await d.engine.runCycle()
}

/** D synced two notes on account A, then a switch to B died after parking A's journal and only one of the notes. */
async function interruptedSwitch(): Promise<{
  d: Device
  serverA: FakeSyncServer
  serverB: FakeSyncServer
  e: Device
}> {
  const serverA = new FakeSyncServer()
  const serverB = new FakeSyncServer()
  const d = await makeDevice(serverA, "d", undefined, { realStore: true, account: "acc_a" })
  const e = await makeDevice(serverB, "e", undefined, { realStore: true, account: "acc_b" })
  devices.push(d, e)
  await d.write("first.md", note("first on a\n"))
  await d.write("second.md", note("second on a\n"))
  await settle(d)
  const git = join(d.repo.root, ".git")
  const parked = join(git, `omo-sync.account-${tag("acc_a")}`)
  await writeFile(
    join(git, "omo-sync-switch.json"),
    JSON.stringify({ from: "acc_a", to: "acc_b", files: ["first.md", "second.md"] }),
  )
  await rename(join(git, "omo-sync"), parked)
  await mkdir(dirname(join(`${parked}.tree`, "first.md")), { recursive: true })
  await rename(join(d.repo.root, "first.md"), join(`${parked}.tree`, "first.md"))
  return { d, serverA, serverB, e }
}

test("#given a switch to B that died half way #when the device starts signed in to B #then the switch is finished and nothing of A reaches B", async () => {
  const { d, serverB, e } = await interruptedSwitch()
  await d.restart(undefined, undefined, { server: serverB, account: "acc_b" })
  await d.engine.runCycle()
  await d.write("on-b.md", note("written on b\n"))
  await settle(d, e)
  expect(await d.read("second.md")).toBeNull()
  expect(await e.read("first.md")).toBeNull()
  expect(await e.read("second.md")).toBeNull()
  expect(await e.read("on-b.md")).toBe(note("written on b\n"))
})

test("#given a switch to B that died half way #when the device starts signed in to A again #then A's notes are back and B received nothing", async () => {
  const { d, serverA, serverB } = await interruptedSwitch()
  const headOfA = serverA.head
  await d.restart(undefined, undefined, { server: serverA, account: "acc_a" })
  await settle(d)
  expect(await d.read("first.md")).toBe(note("first on a\n"))
  expect(await d.read("second.md")).toBe(note("second on a\n"))
  expect(serverB.head).toBe(0)
  expect(serverA.head).toBe(headOfA)
})

test("#given a switch back to A that died after parking B's journal #when production recreates an empty journal dir and A signs in #then A's journal is restored with its cursor", async () => {
  const serverA = new FakeSyncServer()
  const serverB = new FakeSyncServer()
  const d = await makeDevice(serverA, "d", undefined, { realStore: true, account: "acc_a" })
  devices.push(d)
  await d.write("first.md", note("first on a\n"))
  await settle(d)
  await d.restart(undefined, undefined, { server: serverB, account: "acc_b" })
  await settle(d)
  const git = join(d.repo.root, ".git")
  const parkedA = join(git, `omo-sync.account-${tag("acc_a")}`)
  const appliedA = (JSON.parse(await readFile(join(parkedA, "state.json"), "utf8")) as { applied: number }).applied
  expect(appliedA).toBeGreaterThan(0)
  await writeFile(join(git, "omo-sync-switch.json"), JSON.stringify({ from: "acc_b", to: "acc_a", files: [] }))
  await rename(join(git, "omo-sync"), join(git, `omo-sync.account-${tag("acc_b")}`))

  await d.restart(undefined, undefined, { server: serverA, account: "acc_a" })
  await d.engine.runCycle()

  const state = JSON.parse(await readFile(join(git, "omo-sync", "state.json"), "utf8")) as {
    applied: number
    account: string
  }
  expect(state).toMatchObject({ applied: appliedA, account: "acc_a" })
  expect(existsSync(parkedA)).toBe(false)
  expect(await d.read("first.md")).toBe(note("first on a\n"))
})

test("#given stale parked state of the account being switched away from #when it switches #then only the newest retired copy is kept", async () => {
  const serverA = new FakeSyncServer()
  const serverB = new FakeSyncServer()
  const d = await makeDevice(serverA, "d", undefined, { realStore: true, account: "acc_a" })
  devices.push(d)
  await d.write("first.md", note("first on a\n"))
  await settle(d)
  const git = join(d.repo.root, ".git")
  const parkedA = `omo-sync.account-${tag("acc_a")}`
  for (const name of [parkedA, `${parkedA}.retired-1-aaaa`, `${parkedA}.retired-2-bbbb`])
    await mkdir(join(git, name), { recursive: true })

  await d.restart(undefined, undefined, { server: serverB, account: "acc_b" })
  await settle(d)

  const retired = (await readdir(git)).filter((name) => name.startsWith(`${parkedA}.retired-`))
  expect(retired).toHaveLength(1)
  expect(retired[0]).not.toMatch(/retired-[12]-/)
})
