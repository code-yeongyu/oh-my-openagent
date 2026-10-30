import { afterAll, afterEach, describe, expect, test } from "bun:test"

import { creatorAnchor } from "../crypto/anchor.ts"
import { appendEntries, emptyChain } from "../crypto/chain.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { pinTrustAnchor } from "../crypto/trust-pin.ts"
import type { SyncSession } from "../engine/open.ts"
import { approve, createWorld, type Device, freshStateDir, newDevice, removeWorldStateDirs, type World } from "../recovery/testing/world.test-support.ts"
import { SealRefusedError } from "./sealer.ts"
import { type AccountSessionOutcome, openAccountSession } from "./session.ts"
import { type ChainWireServer, startChainWireServer } from "./testing/chain-wire-server.test-support.ts"

const SPACE = new Uint8Array(16).fill(7)
const OTHER_SPACE = new Uint8Array(16).fill(9)
const encoder = new TextEncoder()

const servers: ChainWireServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
})
afterAll(removeWorldStateDirs)

async function pinnedDir(world: World): Promise<string> {
  const walked = await appendEntries(emptyChain(world.account, creatorAnchor(world.account, world.owner.keyring)), world.server.chain(world.account), createRejectionCounter())
  if (!walked.ok || walked.state.pin === null) throw new Error("the fixture genesis does not anchor")
  const dir = freshStateDir()
  await pinTrustAnchor(dir, world.account, walked.state.pin)
  return dir
}

async function setup() {
  const world = await createWorld("acct-session")
  const server = startChainWireServer(world.account, world.server.chain(world.account))
  servers.push(server)
  const open = (device: Device, pinDir: string, spaceId = SPACE): Promise<AccountSessionOutcome> => {
    const token = server.tokenFor({ ...device.principal })
    return openAccountSession({ baseUrl: server.url, token: () => token, account: world.account, keyring: device.keyring, pinDir, spaceId })
  }
  return { world, server, open }
}

function ready(outcome: AccountSessionOutcome): SyncSession {
  if (!outcome.ok) throw new Error(`no session: ${outcome.reason}`)
  return outcome.session
}

async function push(session: SyncSession, baseSeq: number, key: string, text: string): Promise<number> {
  const batchId = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url")
  const sealed = await session.sealer.seal(batchId, baseSeq, { items: [{ key, ops: encoder.encode(text) }] })
  const digest = new Bun.CryptoHasher("sha256").update(sealed.bytes).digest("hex")
  const uploadId = await session.transport.reserve(sealed.bytes.length, digest)
  await session.transport.upload(uploadId, sealed.bytes)
  const appended = await session.transport.append({ uploadId, digest, baseSeq, batchId, epoch: sealed.epoch, link: sealed.link, recordSig: sealed.recordSig })
  if (!appended.ok) throw new Error("the append was refused as stale")
  return appended.seq
}

async function verifyAt(session: SyncSession, seq: number) {
  const page = await session.transport.pull(seq - 1, 1)
  const entry = page.entries[0]
  if (entry === undefined || entry.seq !== seq) throw new Error(`no pulled entry at ${seq}`)
  return session.verifier.verifyEntry(entry, entry.kind === "batch" ? await session.transport.download(entry.objectId) : new Uint8Array())
}

describe("account sync session", () => {
  test("a batch one member seals is verified and opened by another member, for its own space only", async () => {
    const { world, open } = await setup()
    const second = await newDevice()
    await approve(world, second)
    const ownerSession = ready(await open(world.owner, await pinnedDir(world)))
    const seq = await push(ownerSession, world.server.chain(world.account).length, "notes/a.md", "hello from the owner")

    const verdict = await verifyAt(ready(await open(second, await pinnedDir(world))), seq)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.payload.items.map((item) => [item.key, new TextDecoder().decode(item.ops)])).toEqual([["notes/a.md", "hello from the owner"]])

    const elsewhere = await verifyAt(ready(await open(second, await pinnedDir(world), OTHER_SPACE)), seq)
    expect(elsewhere.ok && elsewhere.payload.items).toEqual([])
  }, 30_000)

  test("a keyring row verifies as an empty step and a later batch still opens", async () => {
    const { world, open } = await setup()
    const session = ready(await open(world.owner, await pinnedDir(world)))
    const keyringVerdict = await verifyAt(session, 1)
    expect(keyringVerdict).toMatchObject({ ok: true, payload: { items: [] } })
    const seq = await push(session, 1, "notes/b.md", "second")
    expect(await verifyAt(session, seq)).toMatchObject({ ok: true })
  }, 30_000)

  test("an object swapped on the server is refused and opens nothing", async () => {
    const { world, server, open } = await setup()
    const session = ready(await open(world.owner, await pinnedDir(world)))
    const seq = await push(session, 1, "notes/a.md", "genuine")
    const tampered = new Uint8Array(server.objectOf(seq) ?? new Uint8Array())
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1
    server.replaceObject(seq, tampered)
    const fresh = ready(await open(world.owner, await pinnedDir(world)))
    const verdict = await verifyAt(fresh, seq)
    expect(verdict.ok).toBe(false)
  }, 30_000)

  test("a batch row whose link the server rewrote is refused as a chain break", async () => {
    const { world, open } = await setup()
    const session = ready(await open(world.owner, await pinnedDir(world)))
    const seq = await push(session, 1, "notes/a.md", "genuine")
    const pinDir = await pinnedDir(world)
    const chain = world.server.chain(world.account)
    const row = chain[seq - 1]
    if (row === undefined) throw new Error("no row")
    chain[seq - 1] = { ...row, link: row.link.replace(/^./, (c) => (c === "A" ? "B" : "A")) }
    const verdict = await verifyAt(ready(await open(world.owner, pinDir)), seq)
    expect(verdict).toEqual({ ok: false, code: "chain_link" })
  }, 30_000)

  test("a device that never paired, or that the chain does not list as a member, gets no session", async () => {
    const { world, open } = await setup()
    expect(await open(world.owner, freshStateDir())).toEqual({ ok: false, reason: "no_pin" })
    expect(await open(await newDevice(), await pinnedDir(world))).toEqual({ ok: false, reason: "not_member" })
  }, 30_000)

  test("sealing on a base the verified chain has not reached is refused", async () => {
    const { world, open } = await setup()
    const session = ready(await open(world.owner, await pinnedDir(world)))
    await expect(session.sealer.seal("AAAAAAAAAAAAAAAAAAAAAA", 5, { items: [] })).rejects.toBeInstanceOf(SealRefusedError)
  }, 30_000)
})
