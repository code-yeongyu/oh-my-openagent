import { afterAll, afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { creatorAnchor } from "../crypto/anchor.ts"
import { appendEntries, emptyChain } from "../crypto/chain.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { pinTrustAnchor } from "../crypto/trust-pin.ts"
import { GIT_TEST_TIMEOUT, gitRepo } from "../engine/engine-harness.test-support.ts"
import { openDeviceSync } from "../engine/open.ts"
import { approve, createWorld, type Device, freshStateDir, newDevice, removeWorldStateDirs, type World } from "../recovery/testing/world.test-support.ts"
import { openAccountSession } from "./session.ts"
import { startChainWireServer } from "./testing/chain-wire-server.test-support.ts"

const SPACE = new Uint8Array(16).fill(3)
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
afterAll(removeWorldStateDirs)

async function pinnedDir(world: World): Promise<string> {
  const walked = await appendEntries(emptyChain(world.account, creatorAnchor(world.account, world.owner.keyring)), world.server.chain(world.account), createRejectionCounter())
  if (!walked.ok || walked.state.pin === null) throw new Error("the fixture genesis does not anchor")
  const dir = freshStateDir()
  await pinTrustAnchor(dir, world.account, walked.state.pin)
  return dir
}

test("two member devices converge through the real engine, account session and chain crypto", async () => {
  const world = await createWorld("acct-roundtrip")
  const second = await newDevice()
  await approve(world, second)
  const server = startChainWireServer(world.account, world.server.chain(world.account))
  cleanup.push(() => server.stop())

  const device = async (name: string, who: Device) => {
    const base = await mkdtemp(join(tmpdir(), `omo-account-${name}-`))
    cleanup.push(() => rm(base, { recursive: true, force: true }))
    const repo = join(base, "repo")
    await mkdir(repo, { recursive: true })
    await gitRepo(repo)
    const token = server.tokenFor({ ...who.principal })
    const opened = await openAccountSession({ baseUrl: server.url, token: () => token, account: world.account, keyring: who.keyring, pinDir: await pinnedDir(world), spaceId: SPACE })
    if (!opened.ok) throw new Error(`no session for ${name}: ${opened.reason}`)
    const sync = await openDeviceSync({ repoDir: repo, stateDir: join(base, "state"), locksDir: join(base, "locks"), session: opened.session, machineId: `m-${name}` })
    if (sync === null) throw new Error(`engine refused for ${name}`)
    cleanup.push(() => sync.close())
    return { repo, sync }
  }
  const a = await device("a", world.owner)
  const b = await device("b", second)

  const note = "---\ndescription: synced\n---\nwritten on the owner\n"
  await writeFile(join(a.repo, "note.md"), note)
  await a.sync.engine.runCycle()
  await b.sync.engine.runCycle()
  expect(await readFile(join(b.repo, "note.md"), "utf8")).toBe(note)

  const reply = "---\ndescription: synced\n---\nwritten on the owner\nand answered on the second device\n"
  await writeFile(join(b.repo, "note.md"), reply)
  await b.sync.engine.runCycle()
  await a.sync.engine.runCycle()
  expect(await readFile(join(a.repo, "note.md"), "utf8")).toBe(reply)
  expect(await a.sync.status()).toMatchObject({ kind: "synced" })
}, GIT_TEST_TIMEOUT * 2)
