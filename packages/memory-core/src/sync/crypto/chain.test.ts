import { describe, expect, test } from "bun:test"
import { type AppendOutcome, appendEntries, type ChainState, emptyChain } from "./chain.ts"
import type { BatchEntry, KeyringEntry, SyncEntry } from "./entry.ts"
import { createRejectionCounter } from "./rejection.ts"
import {
  ACCOUNT,
  appendBatch,
  appendKeyring,
  chain,
  deviceId,
  keyringFor,
  mainChain,
  objects,
  readBytes,
  record,
  recoverySigningSeed,
  fixtureAnchor,
} from "./testing/sync-v1.test-support.ts"

const run = (entries: ReadonlyArray<SyncEntry>, state: ChainState = emptyChain(ACCOUNT, fixtureAnchor())) => {
  const rejections = createRejectionCounter()
  return appendEntries(state, entries, rejections).then((outcome) => ({ outcome, rejections }))
}

const verified = async (entries: ReadonlyArray<SyncEntry>): Promise<ChainState> => {
  const { outcome } = await run(entries)
  if (!outcome.ok) throw new Error(`fixture prefix refused at seq ${outcome.seq}: ${outcome.reason}`)
  return outcome.state
}

const headOf = (state: ChainState) => {
  if (state.head === null) throw new Error("empty chain")
  return state.head
}

const refusal = (outcome: AppendOutcome) => (outcome.ok ? null : { seq: outcome.seq, reason: outcome.reason })

const objectDigest = (file: string): string => {
  const entry = objects.objects.find((candidate) => candidate.file === file)
  if (entry === undefined) throw new Error(`fixture object ${file} is missing`)
  return entry.sha256
}

describe("the local verified chain over the sync-v1 fixtures", () => {
  test("the main chain verifies from genesis and folds every keyring record kind", async () => {
    const { outcome, rejections } = await run(mainChain())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.steps.map((step) => (step.kind === "keyring" ? step.record : step.kind))).toEqual([
      "genesis",
      "recovery-key",
      "recovery-key-removed",
      "approval",
      "recovery-join",
      "rotation",
      "recovery-join-vetoed",
      "rotation",
    ])
    const authority = outcome.state.authority
    expect([...(authority?.members.keys() ?? [])].sort()).toEqual([deviceId("owner"), deviceId("joining")].sort())
    expect(authority?.registry.size).toBe(0)
    expect(authority?.epoch).toBe(3)
    expect(rejections.count()).toBe(0)
  })

  test("the second-recovery branch verifies: a join with the second enrolled key resets membership", async () => {
    const state = await verified([record("genesis"), record("recovery_key"), ...chain.branches.recovery2.map(record)])
    expect([...(state.authority?.members.keys() ?? [])]).toEqual([deviceId("recovered2")])
    expect([...(state.authority?.registry.keys() ?? [])]).toEqual([String(record("recovery_key").body["credential_id"])])
  })

  test("a member's batch after the veto rotation is accepted with the folded signing key", async () => {
    const state = await verified(mainChain())
    const batch = await appendBatch(headOf(state), objectDigest("batch-c-epoch3.omob"), 3, keyringFor("owner"))
    const { outcome, rejections } = await run([batch], state)
    expect(outcome.ok && outcome.steps).toEqual([
      { kind: "batch", batch: { seq: 9, digest: batch.digest, epoch: 3, authorId: deviceId("owner"), signingPublicKey: keyringFor("owner").publicKeys().signing } },
    ])
    expect(rejections.count()).toBe(0)
  })
})

describe("receiver refusals: nothing that fails a check is applied", () => {
  test("the rotated-out signer's batch is refused", async () => {
    const state = await verified(mainChain())
    const rotatedOut: BatchEntry = JSON.parse(new TextDecoder().decode(readBytes("corrupted/rotated-out-signer.record.json")))
    const { outcome, rejections } = await run([rotatedOut], state)
    expect(refusal(outcome)).toEqual({ seq: 9, reason: "not_member" })
    expect(outcome.state).toBe(state)
    expect(rejections.count()).toBe(1)
  })

  test("a dropped entry is refused at the first broken link, counted once", async () => {
    const entries = mainChain()
    const { outcome, rejections } = await run([...entries.slice(0, 3), ...entries.slice(4)])
    expect(refusal(outcome)).toEqual({ seq: 5, reason: "link_mismatch" })
    expect(outcome.state.head?.seq).toBe(3)
    expect(rejections.count()).toBe(1)
  })

  test("a reordered entry is refused, counted once", async () => {
    const [genesis, enrol, removal, approval, ...rest] = mainChain()
    if (genesis === undefined || enrol === undefined || removal === undefined || approval === undefined) throw new Error("short fixture")
    const { outcome, rejections } = await run([genesis, enrol, approval, removal, ...rest])
    expect(refusal(outcome)).toEqual({ seq: 4, reason: "link_mismatch" })
    expect(rejections.count()).toBe(1)
  })

  test("a recovery-key record signed by a revoked (rotated-out) device is refused", async () => {
    const state = await verified(mainChain())
    const enrolment = record("recovery_key").body
    const forged: KeyringEntry = await appendKeyring(
      headOf(state),
      { ...enrolment, epoch: 3, credential_id: "AQIDBAUGBwgJCgsMDQ4PEA" },
      { keyring: keyringFor("recovered") },
    )
    const { outcome, rejections } = await run([forged], state)
    expect(refusal(outcome)).toEqual({ seq: 9, reason: "not_member" })
    expect(rejections.count()).toBe(1)
  })

  test("a recovery-join signed by a removed recovery key is refused", async () => {
    const state = await verified([record("genesis"), record("recovery_key"), record("recovery_key_removed")])
    const join = record("recovery_join_2")
    const forged = await appendKeyring(
      headOf(state),
      { ...join.body, keyring_head: headOf(state).keyring_link },
      { recoverySeed: await recoverySigningSeed("key2"), credentialId: String(join.body["credential_id"]) },
    )
    const { outcome, rejections } = await run([forged], state)
    // The merged receiver's own code: the join names a credential the fold no longer holds.
    expect(refusal(outcome)).toEqual({ seq: 4, reason: "recovery_join_unenrolled" })
    expect(rejections.count()).toBe(1)
  })

  test("an entry whose epoch goes backwards is refused", async () => {
    const state = await verified(mainChain())
    const stale = await appendBatch(headOf(state), objectDigest("batch-a-epoch1.omob"), 1, keyringFor("owner"))
    const { outcome } = await run([stale], state)
    expect(refusal(outcome)).toEqual({ seq: 9, reason: "epoch_mismatch" })
  })

  test("a keyring chain served for another account is refused at the account binding", async () => {
    const { outcome, rejections } = await run(mainChain(), emptyChain("another-account", fixtureAnchor("another-account")))
    expect(refusal(outcome)).toEqual({ seq: 1, reason: "account_mismatch" })
    expect(rejections.count()).toBe(1)
  })
})

describe("vetoed-epoch batches", () => {
  test("a batch under the cancelled post-join epoch is skipped without blocking the cursor", async () => {
    const state = await verified(mainChain())
    const vetoed = await appendBatch(headOf(state), objectDigest("batch-d-epoch3-recovered.omob"), 2, keyringFor("recovered"))
    const vetoedHead = { seq: vetoed.seq, link: vetoed.link, keyring_link: headOf(state).keyring_link }
    const next = await appendBatch(vetoedHead, objectDigest("batch-c-epoch3.omob"), 3, keyringFor("owner"))
    const { outcome, rejections } = await run([vetoed, next], state)
    expect(outcome.ok && outcome.steps.map((step) => step.kind)).toEqual(["vetoed", "batch"])
    expect(outcome.state.head?.seq).toBe(10)
    expect(rejections.count()).toBe(0)
  })
})
