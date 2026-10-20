import { beforeAll, describe, expect, mock, spyOn, test } from "bun:test"
import { type AppendOutcome, appendEntries, type ChainState, emptyChain } from "./chain.ts"
import type { KeyringEntry, SyncEntry } from "./entry.ts"
import { createRejectionCounter } from "./rejection.ts"
import { importSnapshot, type SnapshotRecord } from "./snapshot.ts"
import { buildFork, rotation } from "./testing/fork.ts"
import { envelopeRefusal } from "./envelope.ts"
import { receiverPass, receiverRefusal, wire } from "./receiver.ts"
import { ACCOUNT, appendBatch, appendKeyring, chain, deviceId, epochKey, keyringFor, keys, mainChain, objects, principalKeys, readBytes, record, fixtureAnchor } from "./testing/sync-v1.test-support.ts"
import { buildBatch } from "./build.ts"
import { b64urlDecode, sha256B64 } from "./vendor/sync-format/jcs.ts"
import * as vendorFold from "./vendor/sync-format/fold.ts"
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

describe("the receiver check does not re-read the verified chain for every new entry", () => {
  test("a long chain is serialized for the receiver about once, not once per later entry", async () => {
    let state = await verified(mainUntil("post_join_rotation").concat(record("post_join_rotation")))
    const entries: KeyringEntry[] = []
    for (let i = 0; i < 48; i++) {
      const next = await rotation(state, "A")
      const { outcome } = await run([next], state)
      if (!outcome.ok) throw new Error(`rotation ${i} refused: ${outcome.reason}`)
      state = outcome.state
      entries.push(next)
    }
    const walked = [...mainUntil("post_join_rotation"), record("post_join_rotation"), ...entries]
    const stringify = spyOn(JSON, "stringify")
    try {
      expect((await run(walked)).outcome.ok).toBe(true)
      const serialized = stringify.mock.results.reduce((sum, result) => sum + (typeof result.value === "string" ? result.value.length : 0), 0)
      const chainBytes = JSON.stringify(walked).length
      expect(serialized).toBeLessThan(3 * chainBytes)
    } finally {
      mock.restore()
    }
  })
})

describe("the receiver walks the chain once per pull, not once per entry", () => {
  const ROTATIONS = 1000
  const BATCHES = 500
  const recoveredPrefix = (): KeyringEntry[] => [...mainUntil("post_join_rotation"), record("post_join_rotation")]
  const rotations = async (count: number): Promise<{ readonly entries: KeyringEntry[]; readonly state: ChainState }> => {
    let state = await verified(recoveredPrefix())
    const entries: KeyringEntry[] = []
    for (let i = 0; i < count; i++) {
      const next = await rotation(state, "A")
      const { outcome } = await run([next], state)
      if (!outcome.ok) throw new Error(`rotation ${i} refused: ${outcome.reason}`)
      state = outcome.state
      entries.push(next)
    }
    return { entries, state }
  }
  let built: { readonly entries: KeyringEntry[]; readonly state: ChainState } | null = null
  const thousand = async () => (built ??= await rotations(ROTATIONS))
  beforeAll(async () => {
    await thousand()
  }, 60000)
  const walkedDuring = async (work: () => Promise<void>): Promise<number> => {
    const fold = spyOn(vendorFold, "foldRefusal")
    try {
      await work()
      return fold.mock.calls.reduce((sum, [entries]) => sum + entries.length, 0)
    } finally {
      mock.restore()
    }
  }

  test("a 1,000-rotation pull folds each entry a bounded number of times", async () => {
    const { entries } = await thousand()
    const pull = [...recoveredPrefix(), ...entries]
    const walked = await walkedDuring(async () => {
      expect((await run(pull)).outcome.ok).toBe(true)
    })
    expect(walked).toBeLessThanOrEqual(2 * pull.length)
  })

  test("a 500-batch pull after a long keyring chain does not re-fold the keyring for each batch", async () => {
    const { entries: all } = await thousand()
    const entries = all.slice(0, 200)
    const state = await verified([...recoveredPrefix(), ...entries])
    const epoch = state.authority?.epoch ?? 0
    let head = headOf(state)
    const batches: SyncEntry[] = []
    for (let i = 0; i < BATCHES; i++) {
      const batch = await appendBatch(head, objects.objects[0]?.sha256 ?? "", epoch, keyringFor("recovered"))
      batches.push(batch)
      head = { seq: batch.seq, link: batch.link, keyring_link: head.keyring_link }
    }
    const walked = await walkedDuring(async () => {
      const { outcome } = await run(batches, state)
      expect(outcome.ok ? outcome.steps.filter((step) => step.kind === "batch").length : outcome.reason).toBe(BATCHES)
    })
    expect(walked).toBeLessThanOrEqual(2 * (recoveredPrefix().length + entries.length + BATCHES))
  })

  test("a snapshot import over a 1,000-rotation keyring prefix folds the prefix a bounded number of times", async () => {
    const { entries } = await thousand()
    const covered = [...recoveredPrefix(), ...entries]
    const last = covered.at(-1)
    if (last === undefined) throw new Error("empty prefix")
    const golden: SnapshotRecord = JSON.parse(new TextDecoder().decode(readBytes("snapshot.json")))
    const record = { ...golden, covers_seq: last.seq, link: last.link, keyring_head: last.keyring_link }
    const walked = await walkedDuring(async () => {
      const imported = await importSnapshot(ACCOUNT, fixtureAnchor(), covered, record, [], epochKey, createRejectionCounter())
      expect(imported.ok ? "imported" : imported.reason).not.toBe("keyring_prefix_refused")
    })
    expect(walked).toBeLessThanOrEqual(2 * covered.length)
  })

  test("a batch checked alone gets the same verdict as the receiver over the whole verified history", async () => {
    const history = mainChain()
    const state = await verified(history)
    const fresh = await appendBatch(headOf(state), objects.objects[0]?.sha256 ?? "", 3, keyringFor("owner"))
    const variants: ReadonlyArray<SyncEntry> = [
      fresh,
      { ...fresh, seq: headOf(state).seq },
      { ...fresh, seq: 1 },
      JSON.parse(JSON.stringify({ ...fresh, author: { kind: "recovery", credential_id: "c" } })),
    ]
    for (const batch of variants) {
      expect(envelopeRefusal(batch)).toBeNull()
      const whole = vendorFold.foldRefusal(wire([...history, batch]))
      expect((await receiverPass(history, [batch]))(batch)).toBe(whole.ok ? null : whole.reason)
      expect(await receiverRefusal(history, batch)).toBe(whole.ok ? null : whole.reason)
    }
  })
})

describe("an entry later in a pull never changes the verdict of an earlier one", () => {
  test.each([
    ["a replay after two new rotations", (r1: KeyringEntry, r2: KeyringEntry) => [r1, r2, r1], 2],
    ["a replay right after one new rotation", (r1: KeyringEntry, _r2: KeyringEntry) => [r1, r1], 1],
    ["an older rotation after two new ones", (r1: KeyringEntry, r2: KeyringEntry) => [r1, r2, r1, r2], 2],
  ] as const)("%s keeps the valid prefix and refuses only the bad entry", async (_name, shape, accepted) => {
    const start = await verified([...mainUntil("post_join_rotation"), record("post_join_rotation")])
    const r1 = await rotation(start, "A")
    const after1 = (await run([r1], start)).outcome
    if (!after1.ok) throw new Error("r1 refused")
    const r2 = await rotation(after1.state, "B")
    const pull = shape(r1, r2)
    const { outcome, rejections } = await run(pull, start)
    expect(outcome.ok).toBe(false)
    expect(outcome.steps.length).toBe(accepted)
    expect(outcome.state.head?.seq).toBe(headOf(start).seq + accepted)
    expect(outcome.ok ? null : outcome.reason).toBe("link_mismatch")
    expect(rejections.count()).toBe(1)
  })
})
