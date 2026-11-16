import { describe, expect, test } from "bun:test"
import { type DeviceKeyring } from "../keyring-port.ts"
import { phraseRecoveryFor } from "../recovery/testing/phrase-key.test-support.ts"
import { creatorAnchor } from "./anchor.ts"
import { appendEntries, type ChainState, emptyChain } from "./chain.ts"
import type { KeyringBody, KeyringEntry, WrapEntry } from "./entry.ts"
import { wrapSetDigest } from "./links.ts"
import { createRejectionCounter } from "./rejection.ts"
import { wire } from "./receiver.ts"
import { genesisEntry, headAfter, newDevice, newRecoveryCredential, principalOf } from "./testing/genesis.ts"
import { appendKeyring } from "./testing/sync-v1.test-support.ts"
import type { ForkEvidence, RecordRef } from "./vendor/sync-format/chain.ts"
import { recomputeForkState } from "./vendor/sync-format/fold.ts"
import { compareRecordRef } from "./vendor/sync-format/fork-set.ts"
import type { JsonValue } from "./vendor/sync-format/jcs.ts"
import { signFramed } from "./vendor/sync-format/keys.ts"

const ACCOUNT = "phrase-chain-account"

const json = <T>(value: unknown): T => JSON.parse(JSON.stringify(value))

const ref = (entry: KeyringEntry): RecordRef => ({
  seq: entry.seq,
  digest: entry.digest,
  keyring_link: entry.keyring_link,
})

const walk = (owner: DeviceKeyring, entries: ReadonlyArray<KeyringEntry>) =>
  appendEntries(emptyChain(ACCOUNT, creatorAnchor(ACCOUNT, owner)), entries, createRejectionCounter())

const walked = async (owner: DeviceKeyring, entries: ReadonlyArray<KeyringEntry>): Promise<ChainState> => {
  const outcome = await walk(owner, entries)
  if (!outcome.ok) throw new Error(`chain refused at seq ${outcome.seq}: ${outcome.reason}`)
  return outcome.state
}

const committed = async (wraps: ReadonlyArray<WrapEntry>) => {
  const sorted = [...wraps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const set = await wrapSetDigest(sorted)
  if (!set.ok) throw new Error("wrap set")
  return { sorted, digest: set.digest }
}

/** Genesis with a passkey recovery key, then a recovery-key record enrolling the fixture phrase key. */
const enrolledPhraseChain = async () => {
  const owner = (await newDevice()).keyring
  const genesis = await genesisEntry(ACCOUNT, owner, "D".repeat(43), newRecoveryCredential())
  const phrase = await phraseRecoveryFor(ACCOUNT)
  const { sorted, digest } = await committed([
    { epoch: 1, id: `recovery:${phrase.key.credential_id}`, wrap: "P".repeat(43) },
  ])
  const countersign = await signFramed(
    "omo-sync/v1/recovery-countersign",
    {
      t: "omo-sync/v1/recovery-countersign",
      account: ACCOUNT,
      custody_root: String(genesis.body["custody_root"]),
      predecessor: genesis.keyring_link,
      wraps_digest: digest,
    },
    phrase.keys.signSeed,
  )
  const body: KeyringBody = {
    kind: "recovery-key",
    account: ACCOUNT,
    epoch: 1,
    ...phrase.key,
    countersign,
    wraps_digest: digest,
  }
  const enrolled = await appendKeyring(headAfter(genesis), body, { keyring: owner }, sorted)
  return { owner, phrase, ancestry: [genesis, enrolled] as const }
}

const rotation = async (owner: DeviceKeyring, state: ChainState, fill: string): Promise<KeyringEntry> => {
  const authority = state.authority
  if (authority === null || state.head === null) throw new Error("no authority")
  const epoch = authority.epoch + 1
  const ids = [`device:${owner.principal().id}`, ...[...authority.registry.keys()].map((id) => `recovery:${id}`)]
  const { sorted, digest } = await committed(ids.map((id) => ({ epoch, id, wrap: fill.repeat(43) })))
  const body: KeyringBody = {
    kind: "rotation",
    account: ACCOUNT,
    epoch,
    fork_resolution: null,
    members: [principalOf(owner)],
    wraps_digest: digest,
  }
  return appendKeyring(state.head, body, { keyring: owner }, sorted)
}

describe("a phrase key enrolled by a recovery-key record (contract sec 9, PR1)", () => {
  test("the anchored walk accepts the enrollment and the registry keeps survivable phrase", async () => {
    const { owner, phrase, ancestry } = await enrolledPhraseChain()
    const state = await walked(owner, ancestry)
    expect(state.authority?.registry.get(phrase.key.credential_id)).toEqual(phrase.key)
  })

  test("a fork resolution over that chain verifies and keeps survivable phrase", async () => {
    const { owner, phrase, ancestry } = await enrolledPhraseChain()
    const atCommon = await walked(owner, ancestry)
    const [branchA, branchB] = [await rotation(owner, atCommon, "A"), await rotation(owner, atCommon, "B")].sort(
      (x, y) => compareRecordRef(ref(x), ref(y)),
    )
    if (branchA === undefined || branchB === undefined) throw new Error("two branches")
    const proof: ForkEvidence = {
      common: ref(ancestry[1]),
      branches: [branchA, branchB].map((tip) => ({ tip: ref(tip), records: wire([{ ...tip, wraps: [] }]) })),
    }
    const forkState = recomputeForkState(wire([...ancestry]), proof)
    expect(forkState.recovery_keys.find((key) => key.credential_id === phrase.key.credential_id)?.survivable).toBe(
      "phrase",
    )
    const atTip = await walked(owner, [...ancestry, branchA])
    if (atTip.head === null) throw new Error("no tip")
    const resolution = await appendKeyring(
      atTip.head,
      {
        kind: "fork-resolution",
        account: ACCOUNT,
        epoch: forkState.epoch,
        fork_set: json<JsonValue>([branchA, branchB].map(ref)),
        evidence: json<JsonValue>(proof),
        continuation: json<JsonValue>(ref(branchA)),
        state: json<JsonValue>(forkState),
        merged_digest: branchA.digest,
      },
      { keyring: owner },
    )
    const resolved = await walked(owner, [...ancestry, branchA, resolution])
    expect(resolved.authority?.registry.get(phrase.key.credential_id)).toEqual(phrase.key)
  })
})
