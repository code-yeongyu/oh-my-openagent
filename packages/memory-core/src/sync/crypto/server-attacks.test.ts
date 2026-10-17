import { describe, expect, test } from "bun:test"
import { buildBatch } from "./build.ts"
import { appendEntries, type ChainState, emptyChain } from "./chain.ts"
import type { KeyringEntry, SyncEntry } from "./entry.ts"
import { nextLink } from "./links.ts"
import { createRejectionCounter } from "./rejection.ts"
import { importSnapshot } from "./snapshot.ts"
import { buildFork, rotation } from "./testing/fork.ts"
import { genesisEntry, newDevice, newRecoveryCredential } from "./testing/genesis.ts"
import { sealedEpochWrap } from "./testing/hpke-seal.ts"
import { pinnedFixtureAnchor } from "./testing/pinned.test-support.ts"
import { ACCOUNT, appendBatch, appendKeyring, chain, fixtureAnchor, keyringFor, mainChain, objects, record } from "./testing/sync-v1.test-support.ts"
import { b64urlDecode, b64urlEncode, sha256B64 } from "./vendor/sync-format/jcs.ts"
import { signFramed } from "./vendor/sync-format/keys.ts"
import { snapshotPreimage } from "./vendor/sync-format/snapshot.ts"

const run = async (state: ChainState, entries: ReadonlyArray<SyncEntry>) => {
  const rejections = createRejectionCounter()
  const outcome = await appendEntries(state, entries, rejections)
  return { outcome, count: rejections.count(), reason: outcome.ok ? "accepted" : outcome.reason }
}

const verified = async (entries: ReadonlyArray<SyncEntry>): Promise<ChainState> => {
  const { outcome } = await run(emptyChain(ACCOUNT, fixtureAnchor()), entries)
  if (!outcome.ok) throw new Error(`prefix refused: ${outcome.reason}`)
  return outcome.state
}

/** A self-consistent account the server built alone: its own device, genesis, snapshot and chunk. */
const forgedSnapshot = async (account: string) => {
  const server = await newDevice()
  const key = crypto.getRandomValues(new Uint8Array(32))
  const id = `device:${server.keyring.principal().id}`
  const genesis = await genesisEntry(account, server.keyring, await sealedEpochWrap(server.keyring.publicKeys().sealing, account, id, key), newRecoveryCredential())
  const chunk = await buildBatch({
    account, kind: "snapshot", epoch: 1, epochKey: key, keyring: server.keyring, peers: [], batchId: new Uint8Array(16).fill(5),
    salt: new Uint8Array(32).fill(6), createdAt: 1760000000000, chunk: { index: 0, count: 1 },
    records: [{ type: 1, spaceId: new Uint8Array(16), itemKey: "planted", body: new Uint8Array([1]) }],
  })
  const author = { kind: "device" as const, id: server.keyring.principal().id, sealing_public_key: server.keyring.publicKeys().sealing, signing_public_key: server.keyring.publicKeys().signing }
  const digest = await sha256B64(b64urlDecode(await sha256B64(chunk)))
  const unsigned = { account, author, covers_seq: 1, digest, link: genesis.link, keyring_head: genesis.keyring_link, record_sig: "" }
  const snapshot = { ...unsigned, record_sig: await signFramed("omo-sync/v1/snapshot", snapshotPreimage(unsigned), server.signingSeed) }
  return { genesis, snapshot, chunk, key }
}

describe("H2: importSnapshot binds the account the caller expects", () => {
  test("a self-consistent account the server forged is refused for the caller's account", async () => {
    const forged = await forgedSnapshot("forged-account")
    const rejections = createRejectionCounter()
    const imported = await importSnapshot(ACCOUNT, fixtureAnchor(), [forged.genesis], forged.snapshot, [forged.chunk], () => forged.key, rejections)
    expect(imported).toEqual({ ok: false, reason: "account_mismatch" })
    expect(rejections.count()).toBe(1)
  })

  test("a snapshot whose history from genesis is not the pinned root is refused as untrusted_root", async () => {
    const forged = await forgedSnapshot(ACCOUNT)
    const imported = await importSnapshot(ACCOUNT, await pinnedFixtureAnchor(), [forged.genesis], forged.snapshot, [forged.chunk], () => forged.key, createRejectionCounter())
    expect(imported).toEqual({ ok: false, reason: "untrusted_root" })
  })
})

describe("M1: the forced rotation must immediately follow a fork-resolution", () => {
  const resolved = async () => {
    const fork = await buildFork()
    const resolution = await fork.resolution()
    const state = await verified([...fork.ancestry, fork.branchA, resolution])
    if (state.head === null || state.authority === null) throw new Error("fork prefix")
    return { state, head: state.head, epoch: state.authority.epoch, resolution }
  }

  test("a batch right after the resolution is refused", async () => {
    const { state, head, epoch } = await resolved()
    const batch = await appendBatch(head, objects.objects[0]?.sha256 ?? "", epoch, keyringFor("recovered"))
    expect(await run(state, [batch])).toMatchObject({ reason: "forced_rotation_required", count: 1 })
  })

  test("a rotation that does not name the resolution, or names another seq, is refused", async () => {
    const { state, resolution } = await resolved()
    for (const named of [null, 7, resolution.seq + 1]) {
      expect(await run(state, [await rotation(state, "C", named)])).toMatchObject({ reason: "forced_rotation_required", count: 1 })
    }
  })

  test("the forced rotation naming the resolution is accepted", async () => {
    const { state, resolution } = await resolved()
    expect(await run(state, [await rotation(state, "C", resolution.seq)])).toMatchObject({ reason: "accepted", count: 0 })
  })

  test("a rotation naming a fork-resolution when none came before is refused", async () => {
    const state = await verified(chain.main.slice(0, chain.main.indexOf("veto_rotation")).map(record))
    const veto = record("veto_rotation")
    if (state.head === null) throw new Error("prefix")
    const bogus = await appendKeyring(state.head, { ...veto.body, fork_resolution: 7 }, { keyring: keyringFor("owner") }, veto.wraps)
    expect(await run(state, [bogus])).toMatchObject({ reason: "bad_fork_resolution", count: 1 })
  })
})

describe("L1: a hostile row nested beyond any record is refused and counted, never a RangeError", () => {
  test("a 200,000-deep body with a correct link", async () => {
    const state = await verified(mainChain())
    if (state.head === null) throw new Error("prefix")
    let deep: unknown[] = []
    for (let depth = 0; depth < 200000; depth += 1) deep = [deep]
    const digest = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)))
    const author = mainChain()[0]?.author
    const head = state.head
    const fields = { seq: head.seq + 1, base_seq: head.seq, kind: "keyring", account: ACCOUNT, epoch: 3, author, digest, record_sig: "A".repeat(86), wraps: [] }
    const row: KeyringEntry = { ...JSON.parse(JSON.stringify(fields)), link: await nextLink(head.link, digest), keyring_link: await nextLink(head.keyring_link, digest), body: { kind: "approval", account: ACCOUNT, epoch: 3, deep } }
    expect(await run(state, [row])).toMatchObject({ reason: "bad_envelope", count: 1 })
  })
})
