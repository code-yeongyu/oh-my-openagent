import { afterAll, afterEach, describe, expect, test } from "bun:test"

import { creatorAnchor } from "../crypto/anchor.ts"
import { appendEntries, emptyChain } from "../crypto/chain.ts"
import type { KeyringEntry } from "../crypto/entry.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { loadTrustAnchor, pinTrustAnchor } from "../crypto/trust-pin.ts"
import type { SyncSession } from "../engine/open.ts"
import { approve, createWorld, freshStateDir, newDevice, removeWorldStateDirs, type World } from "../recovery/testing/world.test-support.ts"
import { openAccountChain } from "./account-chain.ts"
import { createAccountHttp } from "./http.ts"
import { openAccountSession } from "./session.ts"
import { type ChainWireServer, startChainWireServer } from "./testing/chain-wire-server.test-support.ts"

const SPACE = new Uint8Array(16).fill(7)
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

async function push(session: SyncSession, baseSeq: number, text: string): Promise<number> {
  const batchId = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url")
  const sealed = await session.sealer.seal(batchId, baseSeq, { items: [{ key: "notes/a.md", ops: encoder.encode(text) }] })
  const digest = new Bun.CryptoHasher("sha256").update(sealed.bytes).digest("hex")
  const uploadId = await session.transport.reserve(sealed.bytes.length, digest)
  await session.transport.upload(uploadId, sealed.bytes)
  const appended = await session.transport.append({ uploadId, digest, baseSeq, batchId, epoch: sealed.epoch, link: sealed.link, recordSig: sealed.recordSig })
  if (!appended.ok) throw new Error("the append was refused as stale")
  return appended.seq
}

// Seq 1 is the genesis keyring row, 2 a batch, 3 the keyring row that approves a second device, 4 a batch.
async function fourRowAccount() {
  const world = await createWorld("acct-chain")
  const server = startChainWireServer(world.account, world.server.chain(world.account))
  servers.push(server)
  const token = server.tokenFor({ ...world.owner.principal })
  const pinDir = await pinnedDir(world)
  const opened = await openAccountSession({ baseUrl: server.url, token: () => token, account: world.account, keyring: world.owner.keyring, pinDir, spaceId: SPACE })
  if (!opened.ok) throw new Error(`no session: ${opened.reason}`)
  await push(opened.session, 1, "before")
  await approve(world, await newDevice())
  await push(opened.session, 3, "after")
  expect(world.server.chain(world.account).map((entry) => entry.kind)).toEqual(["keyring", "batch", "keyring", "batch"])
  return { world, server, token, pinDir }
}

// The real HTTP client against the server, with two knobs: a page size cap like the service's, and
// a `/keys` answer that disagrees with `/entries` for one seq.
function servedHttp(input: { url: string; token: string; page?: number }) {
  const real = createAccountHttp({ baseUrl: input.url, token: () => input.token })
  const knobs = { badKeyringSeq: null as number | null }
  const http = {
    ...real,
    listEntriesAfter: async (after: number) => (await real.listEntriesAfter(after))?.slice(0, input.page ?? Number.MAX_SAFE_INTEGER) ?? null,
    listKeys: async () =>
      (await real.listKeys())?.map((entry): KeyringEntry => (entry.seq === knobs.badKeyringSeq ? { ...entry, digest: `${entry.digest}x` } : entry)) ?? null,
  }
  return { http, knobs }
}

async function openChain(world: World, pinDir: string, http: ReturnType<typeof servedHttp>["http"]) {
  const pin = await loadTrustAnchor(pinDir, world.account)
  if (!pin.ok) throw new Error(`no pin: ${pin.reason}`)
  const lines: string[] = []
  const rejections = createRejectionCounter((line) => lines.push(line))
  const chain = await openAccountChain({ account: world.account, anchor: pin.anchor, keyring: world.owner.keyring, http, rejections })
  return { chain, rejections, lines }
}

describe("account chain over served pages", () => {
  test("valid, bad keyring row, valid: the row before is kept, the bad one counted, the one after held and then kept", async () => {
    const { world, server, token, pinDir } = await fourRowAccount()
    const { http, knobs } = servedHttp({ url: server.url, token })
    knobs.badKeyringSeq = 3
    const { chain, rejections, lines } = await openChain(world, pinDir, http)

    expect((await chain.reach(2)).kind).toBe("batch")
    expect(rejections.count()).toBe(1)
    expect(lines).toEqual(["sync.batch.rejected keyring_mismatch"])
    expect((await chain.reach(3)).kind).toBe("pending")
    expect((await chain.reach(4)).kind).toBe("pending")
    expect(chain.state().head?.seq).toBe(2)

    knobs.badKeyringSeq = null
    expect((await chain.reach(4)).kind).toBe("batch")
    expect((await chain.reach(3)).kind).toBe("keyring")
    expect(chain.state().head?.seq).toBe(4)
  }, 30_000)

  test("a row the device cannot read is counted with its reason only and holds the rest", async () => {
    const { world, server, token, pinDir } = await fourRowAccount()
    const { http } = servedHttp({ url: server.url, token })
    let garbled = true
    const reading = { ...http, listEntriesAfter: async (after: number) => (await http.listEntriesAfter(after))?.map((row) => (garbled && row.seq === 3 ? { ...row, seq: "three" } : row)) ?? null }
    const { chain, lines } = await openChain(world, pinDir, reading as typeof http)

    expect((await chain.reach(2)).kind).toBe("batch")
    expect((await chain.reach(4)).kind).toBe("pending")
    expect(lines).toEqual(["sync.batch.rejected entry_unreadable", "sync.batch.rejected entry_unreadable"])
    garbled = false
    expect((await chain.reach(4)).kind).toBe("batch")
  }, 30_000)

  test("rows served one page at a time are all walked, so membership past the first page is found", async () => {
    const { world, server, token, pinDir } = await fourRowAccount()
    const { http } = servedHttp({ url: server.url, token, page: 1 })
    const { chain } = await openChain(world, pinDir, http)
    expect(chain.state().head?.seq).toBe(4)
    expect(chain.isMember()).toBe(true)
    expect((await chain.reach(4)).kind).toBe("batch")
  }, 30_000)
})
