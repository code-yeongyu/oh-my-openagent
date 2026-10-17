import { describe, expect, test } from "bun:test"
import { type AppendOutcome, appendEntries, type ChainState, emptyChain } from "./chain.ts"
import type { KeyringEntry, SyncEntry } from "./entry.ts"
import { createRejectionCounter } from "./rejection.ts"
import { importSnapshot, type SnapshotRecord } from "./snapshot.ts"
import { buildFork } from "./testing/fork.ts"
import { ACCOUNT, appendBatch, appendKeyring, chain, deviceId, epochKey, keyringFor, keys, mainChain, objects, principalKeys, readBytes, record, fixtureAnchor } from "./testing/sync-v1.test-support.ts"
import { buildBatch } from "./build.ts"
import { b64urlDecode, sha256B64 } from "./vendor/sync-format/jcs.ts"
import { signFramed } from "./vendor/sync-format/keys.ts"
import { snapshotPreimage } from "./vendor/sync-format/snapshot.ts"

// The client's local chain must refuse exactly what the merged omo-service receiver
// (vendored sync-format receiveKeyringChain, 3bedb0a) refuses, and accept what it accepts.

const run = async (entries: ReadonlyArray<SyncEntry>, state: ChainState = emptyChain(ACCOUNT, fixtureAnchor())) => {
  const rejections = createRejectionCounter()
  const outcome = await appendEntries(state, entries, rejections)
  return { outcome, rejections }
}
const refusal = (outcome: AppendOutcome) => (outcome.ok ? null : { seq: outcome.seq, reason: outcome.reason })
const verified = async (entries: ReadonlyArray<SyncEntry>): Promise<ChainState> => {
  const { outcome } = await run(entries)
  if (!outcome.ok) throw new Error(`fixture prefix refused at seq ${outcome.seq}: ${outcome.reason}`)
  return outcome.state
}
const headOf = (state: ChainState) => {
  if (state.head === null) throw new Error("empty chain")
  return state.head
}
const mainUntil = (name: string): KeyringEntry[] => chain.main.slice(0, chain.main.indexOf(name)).map(record)

describe("keyring records the merged receiver refuses", () => {
  test("a join is vetoed at most once: a second veto naming it is refused and changes nothing", async () => {
    const state = await verified(mainChain())
    const again = await appendKeyring(headOf(state), { ...record("recovery_join_vetoed").body, epoch: 3 }, { keyring: keyringFor("owner") })
    const { outcome, rejections } = await run([again], state)
    expect(refusal(outcome)).toEqual({ seq: again.seq, reason: "join_already_vetoed" })
    expect(outcome.state).toBe(state)
    expect(rejections.count()).toBe(1)
  })

  test("a rotation whose member list is out of order or duplicated is refused, not re-sorted", async () => {
    const state = await verified(mainUntil("veto_rotation"))
    const rotation = record("veto_rotation")
    const members = Array.isArray(rotation.body["members"]) ? rotation.body["members"] : []
    expect(members.length).toBeGreaterThan(1)
    for (const bad of [[...members].reverse(), [...members, ...members.slice(-1)]]) {
      const entry = await appendKeyring(headOf(state), { ...rotation.body, members: bad }, { keyring: keyringFor("owner") }, rotation.wraps)
      expect(refusal((await run([entry], state)).outcome)).toEqual({ seq: entry.seq, reason: "noncanonical_order" })
    }
  })

  test("a wrap set out of (epoch, id) order is refused as such, not as a digest mismatch", async () => {
    const genesis = record("genesis")
    expect(genesis.wraps.length).toBeGreaterThan(1)
    const reversed = { ...genesis, wraps: [...genesis.wraps].reverse() }
    expect(refusal((await run([reversed])).outcome)).toEqual({ seq: 1, reason: "noncanonical_order" })
  })

  test("a recovery-join authored by a member device is refused", async () => {
    const state = await verified(mainUntil("recovery_join"))
    const join = record("recovery_join")
    const byDevice = await appendKeyring(headOf(state), join.body, { keyring: keyringFor("owner") })
    expect(refusal((await run([byDevice], state)).outcome)).toEqual({ seq: join.seq, reason: "recovery_join_author" })
  })

  test("a batch row carrying a keyring body is refused", async () => {
    const state = await verified(mainChain())
    const batch = await appendBatch(headOf(state), objects.objects[0]?.sha256 ?? "", 3, keyringFor("owner"))
    const withBody = JSON.parse(JSON.stringify({ ...batch, body: record("approval").body }))
    expect(refusal((await run([withBody], state)).outcome)).toEqual({ seq: batch.seq, reason: "batch_with_body" })
  })
})

describe("a fork-resolution is verified and folded like the merged receiver", () => {
  test("a proven resolution verifies and its stated state becomes the authority", async () => {
    const fork = await buildFork()
    const resolution = await fork.resolution()
    const { outcome, rejections } = await run([...fork.ancestry, fork.branchA, resolution])
    expect(outcome.ok).toBe(true)
    const state: unknown = Reflect.get(Object(resolution.body), "state")
    const members: unknown = Reflect.get(Object(state), "members")
    const ids = Array.isArray(members) ? members.map((m: unknown) => Reflect.get(Object(m), "id")) : []
    expect([...(outcome.state.authority?.members.keys() ?? [])]).toEqual(ids)
    expect(outcome.state.authority?.epoch).toBe(Number(Reflect.get(Object(state), "epoch")))
    expect(outcome.state.head?.seq).toBe(resolution.seq)
    expect(rejections.count()).toBe(0)
  })

  test("a resolution whose evidence carries a forged signature is refused, counted once", async () => {
    const fork = await buildFork()
    const forged = await fork.resolution((evidence) => {
      const record = evidence.branches[1]?.records[0]
      if (record !== undefined) record["record_sig"] = "A".repeat(86)
      return evidence
    })
    const { outcome, rejections } = await run([...fork.ancestry, fork.branchA, forged])
    expect(refusal(outcome)).toEqual({ seq: forged.seq, reason: "fork_evidence_invalid" })
    expect(rejections.count()).toBe(1)
  })

  test("a branch record the receiver would refuse refuses the evidence (#456)", async () => {
    const fork = await buildFork()
    const refusedRecord = await fork.resolution((evidence) => {
      const record = evidence.branches[1]?.records[0]
      if (record !== undefined) record["author"] = { kind: "robot", id: "r" }
      return evidence
    })
    const { outcome } = await run([...fork.ancestry, fork.branchA, refusedRecord])
    expect(refusal(outcome)).toEqual({ seq: refusedRecord.seq, reason: "fork_evidence_invalid" })
  })
})

describe("snapshot import matches the merged receiver", () => {
  const golden: SnapshotRecord = JSON.parse(new TextDecoder().decode(readBytes("snapshot.json")))
  const chunks = () => objects.snapshot.chunks.map((file) => readBytes(`objects/${file}`))

  test("the golden snapshot.json (author in the signed preimage) imports, chunks in any order", async () => {
    for (const order of [chunks(), chunks().reverse()]) {
      const imported = await importSnapshot(ACCOUNT, fixtureAnchor(), mainChain(), golden, order, epochKey, createRejectionCounter())
      expect(imported.ok && imported.records.map((r) => r.itemKey)).toEqual(["snapshot part 0", "snapshot part 1"])
    }
  })

  test("right after a veto the chunk epoch is the newest live one (1), not the cancelled one (2)", async () => {
    const entries = mainUntil("veto_rotation")
    const veto = entries.at(-1)
    if (veto === undefined) throw new Error("fixture main chain is short")
    const owner = keys.devices.owner
    const author = { kind: "device" as const, id: deviceId("owner"), ...principalKeys(keyringFor("owner")) }
    const sealedAt = async (epoch: number) => {
      const chunk = await buildBatch({
        account: ACCOUNT, kind: "snapshot", epoch, epochKey: epochKey(epoch) ?? new Uint8Array(32), keyring: keyringFor("owner"),
        peers: [], batchId: new Uint8Array(16).fill(5), salt: new Uint8Array(32).fill(6), createdAt: 1760000000000,
        chunk: { index: 0, count: 1 }, records: [{ type: 1, spaceId: new Uint8Array(16), itemKey: "after-veto", body: new Uint8Array([1]) }],
      })
      const digest = await sha256B64(b64urlDecode(await sha256B64(chunk)))
      const unsigned = { account: ACCOUNT, author, covers_seq: veto.seq, digest, link: veto.link, keyring_head: veto.keyring_link, record_sig: "" }
      const record_sig = await signFramed("omo-sync/v1/snapshot", snapshotPreimage(unsigned), b64urlDecode(owner.signing_seed))
      return importSnapshot(ACCOUNT, fixtureAnchor(), entries, { ...unsigned, record_sig }, [chunk], epochKey, createRejectionCounter())
    }
    expect((await sealedAt(1)).ok).toBe(true)
    expect((await sealedAt(2)).ok).toBe(false)
  })
})
