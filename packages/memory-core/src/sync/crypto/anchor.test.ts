import { describe, expect, test } from "bun:test"
import type { DeviceKeyring } from "../keyring-port.ts"
import { type BootstrapAnchor, type ChainAnchor, creatorAnchor, pairingAnchor, recoveryAnchor, type TrustAnchor } from "./anchor.ts"
import { appendEntries, atVerifiedHead, type ChainState, emptyChain, isChainState, isVerifiedWrap, verifyKeyringEntry } from "./chain.ts"
import type { KeyringEntry, VerifiedWrap } from "./entry.ts"
import { createRejectionCounter } from "./rejection.ts"
import { approvalEntry, genesisEntry, headAfter, newDeviceKeyring, newRecoveryCredential, type PairingTranscript, pairingTranscript } from "./testing/genesis.ts"
import { sealedEpochWrap } from "./testing/hpke-seal.ts"
import { pinnedFixtureAnchor } from "./testing/pinned.test-support.ts"
import { ACCOUNT, fixtureAnchor, mainChain, record } from "./testing/sync-v1.test-support.ts"
import { openWrap } from "./unwrap.ts"

// Every case here plays the server: it controls every row the device fetches, and can sign with keys
// it made itself. Only the device's own ceremony output (or its pin) may decide which history is real.

const walk = async (anchor: ChainAnchor, entries: ReadonlyArray<KeyringEntry>) => {
  const logged: string[] = []
  const rejections = createRejectionCounter((line) => logged.push(line))
  const start = emptyChain(ACCOUNT, anchor)
  const outcome = await appendEntries(start, entries, rejections)
  return { outcome, start, logged }
}

const expectRefused = (result: Awaited<ReturnType<typeof walk>>, reason: string) => {
  expect(result.outcome.ok ? "accepted" : result.outcome.reason).toBe(reason)
  expect(result.outcome.state).toBe(result.start)
  expect(result.outcome.steps).toEqual([])
  expect(result.logged).toEqual([`sync.batch.rejected ${reason}`])
}

const ceremony = (self: DeviceKeyring, approver: DeviceKeyring, transcript: PairingTranscript): BootstrapAnchor =>
  pairingAnchor({
    account: ACCOUNT,
    keyring: self,
    approver: { sealing_public_key: approver.publicKeys().sealing, signing_public_key: approver.publicKeys().signing },
    joiningNonce: transcript.joining_nonce,
    approverNonce: transcript.approver_nonce,
  })

const accountBy = async (owner: DeviceKeyring, joining: DeviceKeyring, transcript: PairingTranscript, epochKey: Uint8Array) => {
  const ownerId = `device:${owner.principal().id}`
  const genesis = await genesisEntry(ACCOUNT, owner, await sealedEpochWrap(owner.publicKeys().sealing, ACCOUNT, ownerId, epochKey), newRecoveryCredential())
  const joiningId = `device:${joining.principal().id}`
  const approval = await approvalEntry(headAfter(genesis), ACCOUNT, owner, joining, transcript, await sealedEpochWrap(joining.publicKeys().sealing, ACCOUNT, joiningId, epochKey))
  return [genesis, approval] as const
}

const opened = async (keyring: DeviceKeyring, state: ChainState) => {
  const wrap = state.received.flatMap((entry) => entry.wraps).find((candidate) => candidate.id === `device:${keyring.principal().id}`)
  return wrap === undefined ? null : openWrap(keyring, wrap, ACCOUNT, new Map())
}

describe("H1: a joining device trusts only the approval its own ceremony bound", () => {
  test("the genuine approver's approval with the ceremony's transcript anchors the chain, and its wrap opens", async () => {
    const [approver, joining] = [await newDeviceKeyring(), await newDeviceKeyring()]
    const transcript = await pairingTranscript(ACCOUNT, joining)
    const epochKey = crypto.getRandomValues(new Uint8Array(32))
    const { outcome } = await walk(ceremony(joining, approver, transcript), await accountBy(approver, joining, transcript, epochKey))
    if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`)
    expect(outcome.state.pin?.pinnedBy).toBe("pairing")
    expect(outcome.state.pin?.genesisDigest).toBe(outcome.state.genesisDigest ?? "")
    const result = await opened(joining, outcome.state)
    expect(result?.ok === true && [...result.keys.current]).toEqual([...epochKey])
  })

  test("a chain the server fabricated from scratch is refused and none of its wraps opens", async () => {
    const [approver, joining, server] = [await newDeviceKeyring(), await newDeviceKeyring(), await newDeviceKeyring()]
    const transcript = await pairingTranscript(ACCOUNT, joining)
    const forged = await accountBy(server, joining, transcript, crypto.getRandomValues(new Uint8Array(32)))
    const result = await walk(ceremony(joining, approver, transcript), forged)
    expectRefused(result, "anchor_mismatch")
    const servedWrap = forged[1].wraps[0]
    if (servedWrap === undefined) throw new Error("forged approval has no wrap")
    // @ts-expect-error a wrap taken from a served row is a plain WrapEntry, never a VerifiedWrap
    expect(await openWrap(joining, servedWrap, ACCOUNT, new Map())).toEqual({ ok: false, reason: "unverified_wrap" })
  })

  test("a counterpart key or transcript the server swapped in is refused", async () => {
    const [approver, joining] = [await newDeviceKeyring(), await newDeviceKeyring()]
    const transcript = await pairingTranscript(ACCOUNT, joining)
    const chain = await accountBy(approver, joining, transcript, crypto.getRandomValues(new Uint8Array(32)))
    const otherApprover = await newDeviceKeyring()
    for (const anchor of [
      ceremony(joining, otherApprover, transcript),
      ceremony(joining, approver, { ...transcript, approver_nonce: "AAAAAAAAAAAAAAAAAAAAAA" }),
      ceremony(joining, approver, { ...transcript, joining_nonce: "AAAAAAAAAAAAAAAAAAAAAA" }),
    ]) {
      expectRefused(await walk(anchor, chain), "anchor_mismatch")
    }
  })

  test("a record verified before the anchor is met is held raw: nothing is minted and its wrap never opens", async () => {
    const [approver, joining] = [await newDeviceKeyring(), await newDeviceKeyring()]
    const transcript = await pairingTranscript(ACCOUNT, joining)
    const [genesis] = await accountBy(approver, joining, transcript, crypto.getRandomValues(new Uint8Array(32)))
    const step = await verifyKeyringEntry(emptyChain(ACCOUNT, ceremony(joining, approver, transcript)), genesis, "main")
    if (!step.ok) throw new Error(`genesis refused: ${step.reason}`)
    expect({ anchored: step.state.anchored, received: step.state.received.length, held: step.state.unanchored.length }).toEqual({ anchored: false, received: 0, held: 1 })
    const held = step.state.unanchored[0]?.wraps ?? []
    expect(held.length).toBeGreaterThan(0)
    expect(held.some((wrap) => isVerifiedWrap(wrap))).toBe(false)
  })

  test("a walk that never reaches this device's approval is refused as a whole", async () => {
    const [approver, joining] = [await newDeviceKeyring(), await newDeviceKeyring()]
    const transcript = await pairingTranscript(ACCOUNT, joining)
    const [genesis] = await accountBy(approver, joining, transcript, crypto.getRandomValues(new Uint8Array(32)))
    expectRefused(await walk(ceremony(joining, approver, transcript), [genesis]), "unanchored")
  })
})

describe("H1: a recovering device trusts only the enrolment of the passkey it derived", () => {
  const key1: unknown = Reflect.get(Object(record("genesis").body["bootstrap"]), "recovery_key")
  const derived = (overrides: { readonly signing_public_key?: string } = {}): BootstrapAnchor =>
    recoveryAnchor({
      account: ACCOUNT,
      credentialId: String(Reflect.get(Object(key1), "credential_id")),
      sealing_public_key: String(Reflect.get(Object(key1), "sealing_public_key")),
      signing_public_key: overrides.signing_public_key ?? String(Reflect.get(Object(key1), "signing_public_key")),
    })

  test("the chain whose genesis enrolled the derived keys is anchored there", async () => {
    const { outcome } = await walk(derived(), mainChain())
    expect(outcome.ok && outcome.state.pin?.pinnedBy).toBe("recovery")
  })

  test("a record enrolling this credential under keys the device did not derive is refused", async () => {
    expectRefused(await walk(derived({ signing_public_key: record("genesis").digest }), mainChain()), "anchor_mismatch")
  })
})

describe("a creator device trusts only a genesis signed with its own key", () => {
  test("a genesis the server built does not meet this device's creator anchor", async () => {
    const [device, server] = [await newDeviceKeyring(), await newDeviceKeyring()]
    const served = await genesisEntry(ACCOUNT, server, "W".repeat(43), newRecoveryCredential())
    expectRefused(await walk(creatorAnchor(ACCOUNT, device), [served]), "anchor_mismatch")
  })

  test("the device's own genesis anchors the chain and the verifier computes the pinned digest", async () => {
    const device = await newDeviceKeyring()
    const own = await genesisEntry(ACCOUNT, device, "W".repeat(43), newRecoveryCredential())
    const { outcome } = await walk(creatorAnchor(ACCOUNT, device), [own])
    expect(outcome.ok && outcome.state.pin?.genesisDigest).toBe(own.digest)
  })
})

describe("every value the verifier trusts is minted by the verifier: a hand-built one of the right shape is refused", () => {
  test("a creator, pairing or recovery anchor built by hand", async () => {
    const [device, server] = [await newDeviceKeyring(), await newDeviceKeyring()]
    const served = await genesisEntry(ACCOUNT, server, "W".repeat(43), newRecoveryCredential())
    const minted = [creatorAnchor(ACCOUNT, server), ceremony(device, server, await pairingTranscript(ACCOUNT, device))]
    for (const anchor of minted) {
      const handBuilt: unknown = JSON.parse(JSON.stringify(anchor))
      // @ts-expect-error only the mint functions create a BootstrapAnchor
      const copy: BootstrapAnchor = handBuilt
      expectRefused(await walk(copy, [served]), "untrusted_root")
    }
    const handRecovery = { kind: "recovery", account: ACCOUNT, credentialId: "c", sealing_public_key: "s", signing_public_key: "k" }
    // @ts-expect-error only recoveryAnchor creates a recovery anchor
    expectRefused(await walk(handRecovery, mainChain()), "untrusted_root")
  })

  test("a chain state built or copied by hand", async () => {
    const { outcome } = await walk(fixtureAnchor(), mainChain())
    if (!outcome.ok) throw new Error(`fixture refused: ${outcome.reason}`)
    const copied: unknown = { ...outcome.state, anchored: true }
    // @ts-expect-error only the chain verifier mints a ChainState
    const state: ChainState = copied
    const rejections = createRejectionCounter()
    const refused = await appendEntries(state, [], rejections)
    expect(refused.ok ? "accepted" : refused.reason).toBe("untrusted_state")
    expect(rejections.count()).toBe(1)
    const step = await verifyKeyringEntry(state, record("approval"), "main")
    expect(step.ok ? "accepted" : step.reason).toBe("untrusted_state")
  })

  test("nothing reachable from a minted state can be changed: head, records, wraps and the authority's maps and sets", async () => {
    const { outcome } = await walk(fixtureAnchor(), mainChain())
    if (!outcome.ok) throw new Error(`fixture refused: ${outcome.reason}`)
    const state = outcome.state
    const authority = state.authority
    const record0 = state.history[0]
    const entry0 = state.received[0]
    if (authority === null || state.head === null || record0 === undefined || entry0 === undefined) throw new Error("fixture has no verified records")
    const attempts: ReadonlyArray<() => unknown> = [
      () => Reflect.apply(Array.prototype.push, state.received, [entry0]),
      () => Reflect.apply(Array.prototype.push, state.history, [record0]),
      () => Reflect.apply(Array.prototype.push, state.unanchored, [entry0]),
      () => Reflect.apply(Array.prototype.push, entry0.wraps, [entry0.wraps[0]]),
      () => Reflect.apply(Map.prototype.set, authority.members, ["evil", record0]),
      () => Reflect.apply(Map.prototype.set, authority.registry, ["evil", record0]),
      () => Reflect.apply(Set.prototype.add, authority.cancelled, ["evil"]),
    ]
    for (const attempt of attempts) expect(attempt).toThrow(TypeError)
    const assignments: ReadonlyArray<readonly [object, string, unknown]> = [
      [state.head, "seq", 999],
      [record0, "digest", "forged"],
      [record0.body, "kind", "genesis"],
      [entry0, "digest", "forged"],
      [entry0.author, "id", "evil"],
      [authority, "epoch", 999],
    ]
    for (const [target, key, value] of assignments) expect(Reflect.set(target, key, value)).toBe(false)
    expect(isChainState(state)).toBe(true)
    expect({ seq: state.head.seq, members: authority.members.size, received: state.received.length }).toEqual({ seq: mainChain().length, members: authority.members.size, received: mainChain().length })
    expect(entry0.wraps.every(isVerifiedWrap)).toBe(true)
  })

  test("atVerifiedHead moves only an anchored state, only forward, and only to its own verified keyring head", async () => {
    const { outcome } = await walk(fixtureAnchor(), mainChain())
    if (!outcome.ok || outcome.state.head === null) throw new Error("fixture refused")
    const head = outcome.state.head
    expect(atVerifiedHead(outcome.state, head)?.head).toEqual(head)
    expect(atVerifiedHead(outcome.state, { ...head, link: "L".repeat(43) })).toBeNull()
    expect(atVerifiedHead(outcome.state, { ...head, seq: head.seq + 5, link: "L".repeat(43) })?.head?.seq).toBe(head.seq + 5)
    expect(atVerifiedHead(outcome.state, { ...head, keyring_link: "K".repeat(43) })).toBeNull()
    expect(atVerifiedHead(outcome.state, { ...head, seq: head.seq - 1 })).toBeNull()
    const [approver, joining] = [await newDeviceKeyring(), await newDeviceKeyring()]
    const transcript = await pairingTranscript(ACCOUNT, joining)
    const [genesis] = await accountBy(approver, joining, transcript, crypto.getRandomValues(new Uint8Array(32)))
    const held = await verifyKeyringEntry(emptyChain(ACCOUNT, ceremony(joining, approver, transcript)), genesis, "main")
    if (!held.ok || held.state.head === null) throw new Error("genesis refused")
    expect(held.state.anchored).toBe(false)
    expect(atVerifiedHead(held.state, held.state.head)).toBeNull()
  })
})

describe("H1: a pinned root refuses every other root", () => {
  test("a valid-looking genesis that is not the pinned one is refused before anything is trusted", async () => {
    const [server, joining] = [await newDeviceKeyring(), await newDeviceKeyring()]
    const substituted = await accountBy(server, joining, await pairingTranscript(ACCOUNT, joining), crypto.getRandomValues(new Uint8Array(32)))
    expectRefused(await walk(await pinnedFixtureAnchor(), substituted), "untrusted_root")
  })

  test("a hand-built pinned anchor is no anchor", async () => {
    const handBuilt = { kind: "pinned", account: ACCOUNT, genesisDigest: record("genesis").digest }
    // @ts-expect-error only the pin store mints a TrustAnchor
    const anchor: TrustAnchor = handBuilt
    expectRefused(await walk(anchor, mainChain()), "untrusted_root")
  })

  test("a hand-built VerifiedWrap does not compile and is refused at runtime", async () => {
    const keyring = await newDeviceKeyring()
    // @ts-expect-error a VerifiedWrap carries a brand no literal can supply
    const forged: VerifiedWrap = { epoch: 1, id: `device:${keyring.principal().id}`, wrap: "Z".repeat(43), account: ACCOUNT }
    expect(await openWrap(keyring, forged, ACCOUNT, new Map())).toEqual({ ok: false, reason: "unverified_wrap" })
  })
})
