import { describe, expect, test } from "bun:test"
import { createDeviceKeyring, generateDeviceKeyMaterial } from "../keyring-port.ts"
import { type AppendOutcome, appendEntries, type ChainState, emptyChain } from "./chain.ts"
import type { KeyringEntry, SyncEntry, WrapEntry } from "./entry.ts"
import { nextLink } from "./links.ts"
import { type BatchBinding, openBatch } from "./open.ts"
import { receiverRefusal } from "./receiver.ts"
import { createRejectionCounter } from "./rejection.ts"
import { buildFork } from "./testing/fork.ts"
import { ACCOUNT, appendBatch, chain, deviceId, epochKey, keyringFor, mainChain, objects, readBytes, record, fixtureAnchor } from "./testing/sync-v1.test-support.ts"
import { compareWrapEntries } from "./vendor/sync-format/canonical.ts"

// Each test plays a malicious server: it takes genuine, correctly signed material and changes
// only what the server controls (unsigned wraps, positions, bodies, envelope fields). Every one
// must be refused, counted once, with a content-free log line.

const run = async (entries: ReadonlyArray<SyncEntry>, state: ChainState = emptyChain(ACCOUNT, fixtureAnchor())) => {
  const logged: string[] = []
  const rejections = createRejectionCounter((line) => logged.push(line))
  const outcome = await appendEntries(state, entries, rejections)
  return { outcome, rejections, logged }
}
const refusal = (outcome: AppendOutcome): { readonly seq: number; readonly reason: string } | null =>
  outcome.ok ? null : { seq: outcome.seq, reason: outcome.reason }
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
const objectNamed = (file: string) => {
  const entry = objects.objects.find((candidate) => candidate.file === file)
  if (entry === undefined) throw new Error(`fixture object ${file} is missing`)
  return entry
}
const served = (value: unknown): SyncEntry => JSON.parse(JSON.stringify(value))

const expectRefusedOnce = (
  result: Awaited<ReturnType<typeof run>>,
  state: ChainState,
  expected: { readonly seq: number; readonly reason: string },
) => {
  expect(refusal(result.outcome)).toEqual(expected)
  expect(result.outcome.state).toBe(state)
  expect(result.rejections.count()).toBe(1)
  expect(result.logged).toEqual([`sync.batch.rejected ${expected.reason}`])
}

describe("HIGH 1: a fork-resolution carries no wraps, whatever the server attaches", () => {
  test("a genuine resolution with a server-attached wrap is refused and the wrap is never stored", async () => {
    const fork = await buildFork()
    const resolution = await fork.resolution()
    const state = await verified([...fork.ancestry, fork.branchA])
    const forgedWrap: WrapEntry = { epoch: 3, id: `device:${deviceId("recovered")}`, wrap: "Z".repeat(43) }
    const result = await run([{ ...resolution, wraps: [forgedWrap] }], state)
    expectRefusedOnce(result, state, { seq: resolution.seq, reason: "unexpected_wraps" })
    expect(result.outcome.state.received.some((entry) => entry.wraps.length > 0 && entry.seq === resolution.seq)).toBe(false)
  })
})

describe("HIGH 2: each security check has a malicious-server test that fails without it", () => {
  test("batch record_sig: a genuine signed batch replayed at a new chain position is refused", async () => {
    const state = await verified(mainChain())
    const genuine = await appendBatch(headOf(state), objectNamed("batch-c-epoch3.omob").sha256, 3, keyringFor("owner"))
    const link = await nextLink(genuine.link, genuine.digest)
    if (link === null) throw new Error("link")
    const replay = { ...genuine, seq: genuine.seq + 1, base_seq: genuine.seq, link }
    const afterGenuine = await verified([...mainChain(), genuine])
    const result = await run([replay], afterGenuine)
    expectRefusedOnce(result, afterGenuine, { seq: replay.seq, reason: "bad_signature" })
  })

  test("keyring body digest: a signed removal whose body the server swaps for another credential is refused", async () => {
    const state = await verified(mainUntil("recovery_key_removed"))
    const removal = record("recovery_key_removed")
    const bootstrap: unknown = record("genesis").body["bootstrap"]
    const otherCredential: unknown = Reflect.get(Object(Reflect.get(Object(bootstrap), "recovery_key")), "credential_id")
    if (typeof otherCredential !== "string") throw new Error("fixture genesis names no recovery credential")
    expect(otherCredential).not.toBe(removal.body["credential_id"])
    const swapped = { ...removal, body: { ...removal.body, credential_id: otherCredential } }
    const result = await run([swapped], state)
    expectRefusedOnce(result, state, { seq: removal.seq, reason: "digest_mismatch" })
  })

  test("approval wrap set: server-forged wraps on a genuine approval are refused", async () => {
    const state = await verified(mainUntil("approval"))
    const approval = record("approval")
    const added = [...approval.wraps, { epoch: approval.epoch, id: `device:${deviceId("owner")}`, wrap: "Z".repeat(43) }].sort(compareWrapEntries)
    const replaced = approval.wraps.map((wrap) => ({ ...wrap, wrap: "Z".repeat(43) }))
    for (const wraps of [added, replaced]) {
      const result = await run([{ ...approval, wraps }], state)
      expectRefusedOnce(result, state, { seq: approval.seq, reason: "wraps_digest_mismatch" })
    }
  })

  test("header chunk binding: a genuine object served for another chunk position or kind is refused", async () => {
    const chunk = objectNamed("snapshot-c0.omob")
    const ops = objectNamed("batch-a-epoch1.omob")
    const bindingOf = (entry: typeof chunk, override: Partial<BatchBinding>): BatchBinding => ({
      account: objects.account,
      epoch: entry.epoch,
      authorId: deviceId(entry.author),
      signingPublicKey: keyringFor(entry.author).publicKeys().signing,
      digest: entry.sha256,
      kind: entry.kind,
      ...(entry.chunk === undefined ? {} : { chunk: entry.chunk }),
      ...override,
    })
    const cases: ReadonlyArray<readonly [typeof chunk, Partial<BatchBinding>]> = [
      [chunk, { chunk: { index: 1, count: 2 } }],
      [chunk, { chunk: { index: 0, count: 3 } }],
      [ops, { chunk: { index: 0, count: 1 } }],
    ]
    for (const [entry, override] of cases) {
      const logged: string[] = []
      const rejections = createRejectionCounter((line) => logged.push(line))
      const bytes = readBytes(`objects/${entry.file}`)
      const opened = await openBatch(bytes, bindingOf(entry, override), epochKey(entry.epoch) ?? new Uint8Array(32), rejections)
      expect(opened).toEqual({ ok: false, reason: "kind_mismatch" })
      expect(logged).toEqual(["sync.batch.rejected kind_mismatch"])
    }
    const unchunked = { ...bindingOf(chunk, {}) }
    delete (unchunked as { chunk?: unknown }).chunk
    const rejections = createRejectionCounter()
    expect(await openBatch(readBytes(`objects/${chunk.file}`), unchunked, epochKey(3) ?? new Uint8Array(32), rejections)).toEqual({ ok: false, reason: "kind_mismatch" })
  })
})

describe("HIGH (lead): the receiver refusing at another seq fails closed", () => {
  test("a receiver refusal at a seq other than the entry's is a typed refusal, never an accept", async () => {
    const prefix = mainChain()
    const genesis = prefix[0]
    if (genesis === undefined) throw new Error("short fixture")
    // A history the receiver refuses at seq 1 (a robot author), followed by an entry it would accept.
    const poisoned = served({ ...genesis, author: { kind: "robot", id: "r" } })
    const refused = await receiverRefusal([poisoned], served(prefix[1]))
    expect(String(refused)).toBe("receiver_seq_mismatch")
  })
})

describe("MEDIUM 3: vetoed-epoch batches are fully verified before the veto applies", () => {
  test("an unsigned batch in the vetoed epoch is refused", async () => {
    const state = await verified(mainChain())
    const genuine = await appendBatch(headOf(state), objectNamed("batch-d-epoch3-recovered.omob").sha256, 2, keyringFor("recovered"))
    const result = await run([{ ...genuine, record_sig: "A".repeat(86) }], state)
    expectRefusedOnce(result, state, { seq: genuine.seq, reason: "bad_signature" })
  })

  test("a batch in the vetoed epoch by an author who was never a member is refused", async () => {
    const state = await verified(mainChain())
    const material = generateDeviceKeyMaterial()
    const stranger = createDeviceKeyring("nobody", material)
    const foreign = await appendBatch(headOf(state), objectNamed("batch-d-epoch3-recovered.omob").sha256, 2, stranger)
    const result = await run([foreign], state)
    expectRefusedOnce(result, state, { seq: foreign.seq, reason: "not_member" })
  })

  test("a genuine vetoed-epoch batch by its epoch's member is still skipped, not applied", async () => {
    const state = await verified(mainChain())
    const genuine = await appendBatch(headOf(state), objectNamed("batch-d-epoch3-recovered.omob").sha256, 2, keyringFor("recovered"))
    const { outcome, rejections } = await run([genuine], state)
    expect(outcome.ok && outcome.steps).toEqual([{ kind: "vetoed", seq: genuine.seq }])
    expect(rejections.count()).toBe(0)
  })
})

describe("MEDIUM 4: the SyncEntry envelope is a closed schema", () => {
  test("a keyring row with an unknown top-level field is refused as bad_envelope", async () => {
    const empty = emptyChain(ACCOUNT, fixtureAnchor())
    const result = await run([served({ ...record("genesis"), server_note: "trust me" })], empty)
    expectRefusedOnce(result, empty, { seq: 1, reason: "bad_envelope" })
  })

  test.each([["null", null], ["an array", []], ["a number", 7], ["a string", "row"], ["a boolean", true]] as const)(
    "a served row that is %s is refused and counted before any field is read",
    async (_shape, row) => {
      const state = await verified(mainChain())
      const result = await run([served(row)], state)
      expectRefusedOnce(result, state, { seq: headOf(state).seq + 1, reason: "bad_envelope" })
    },
  )

  test("a keyring row missing wraps is a counted bad_envelope, not a TypeError", async () => {
    const { wraps: _dropped, ...withoutWraps } = record("genesis")
    const empty = emptyChain(ACCOUNT, fixtureAnchor())
    const result = await run([served(withoutWraps)], empty)
    expectRefusedOnce(result, empty, { seq: 1, reason: "bad_envelope" })
  })

  test("a batch row with an unknown field, an open author or a malformed wrap row is refused", async () => {
    const state = await verified(mainChain())
    const batch = await appendBatch(headOf(state), objectNamed("batch-c-epoch3.omob").sha256, 3, keyringFor("owner"))
    for (const bad of [{ ...batch, server_note: 1 }, { ...batch, author: { ...batch.author, extra: true } }, { ...batch, seq: "9" }]) {
      const result = await run([served(bad)], state)
      expectRefusedOnce(result, state, { seq: batch.seq, reason: "bad_envelope" })
    }
    const approvalState = await verified(mainUntil("approval"))
    const approval = record("approval")
    const wrapRow = approval.wraps.map((wrap) => ({ ...wrap, note: "x" }))
    const result = await run([served({ ...approval, wraps: wrapRow })], approvalState)
    expectRefusedOnce(result, approvalState, { seq: approval.seq, reason: "bad_envelope" })
  })

})
