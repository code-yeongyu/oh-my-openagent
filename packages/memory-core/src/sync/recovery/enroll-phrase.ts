import type { TrustAnchor } from "../crypto/anchor.ts"
import type { ChainState } from "../crypto/chain.ts"
import { isPhraseKey } from "../crypto/parse.ts"
import type { RejectionCounter } from "../crypto/rejection.ts"
import { b64urlEncode } from "../crypto/vendor/sync-format/jcs.ts"
import type { AccountHttp } from "../account/http.ts"
import { withGenesisLock } from "../genesis/intent-store.ts"
import { phraseCreationRefusal, type PhraseGate } from "../genesis/phrase-gate.ts"
import { genesisIntentPresent, genesisPhraseState } from "../genesis/phrase-marker.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import {
  deleteEnrollMarker,
  type EnrollChainFacts,
  type EnrollPlace,
  listEnrollMarkers,
  resolveEnrollMarker,
  writeEnrollMarker,
} from "./enroll-marker.ts"
import { signedAppend } from "./keyring-append.ts"
import type { RecoveryBridge, RecoveryEvent, TransportRefusal } from "./ports.ts"
import { MAX_RECOVERY_KEYS } from "./salt-inputs.ts"
import { committedWrap, expectedHistory, loadServedChain } from "./served-chain.ts"
import { removeRecoveryKey } from "./remove.ts"
import type { PhraseVoidNotice } from "../account/phrase-notice.ts"

export type PhraseEnrollOutcome =
  | { readonly ok: true; readonly credentialId: string; readonly seq: number }
  | { readonly ok: false; readonly reason: "acknowledge-required"; readonly phraseVoid: PhraseVoidNotice }
  | { readonly ok: false; readonly reason: "phrase-unavailable"; readonly why: "disabled" | "service-floor-off" | "no-surface" }
  | { readonly ok: false; readonly reason: "unresolved" }
  | {
      readonly ok: false
      readonly reason:
        | "cancelled"
        | "key-mismatch"
        | "device-wrap-refused"
        | "credential-reused"
        | "unavailable"
        | "unverified"
        | "not-member"
        | "too-many-recovery-keys"
        | TransportRefusal
    }

export type PhraseRotateOutcome =
  | { readonly ok: true; readonly credentialId: string; readonly epoch: number }
  | { readonly ok: false; readonly reason: "rotation-pending"; readonly newSaved: true; readonly oldStillValid: true }
  | (Exclude<PhraseEnrollOutcome, { readonly ok: true }> & { readonly oldStillValid?: true })

export type PhraseEnrollInput = {
  readonly anchor: TrustAnchor
  readonly account: string
  readonly keyring: DeviceKeyring
  readonly bridge: RecoveryBridge
  /** The signed-in account routes; also the transport, and where the service floor is read. */
  readonly chain: AccountHttp
  readonly rejections: RejectionCounter
  readonly pinDir: string
  readonly phraseGate?: PhraseGate
  readonly onCeremony?: (method: "phrase") => void
  readonly onEvent?: (event: RecoveryEvent) => void
}

const credentialsRotatedOutAfterRemoval = (state: ChainState): ReadonlySet<string> => {
  const epoch = state.authority?.epoch ?? 0
  const out = new Set<string>()
  state.history.forEach((record, index) => {
    if (record.body.kind === "recovery-key-removed" && (state.received[index]?.epoch ?? epoch) < epoch)
      out.add(record.body.credentialId)
  })
  return out
}

export const chainFactsOf = (state: ChainState | null): EnrollChainFacts =>
  state?.authority == null
    ? null
    : {
        enrolledEver: state.authority.enrolledEver,
        registry: new Set(state.authority.registry.keys()),
        removedAndRotated: credentialsRotatedOutAfterRemoval(state),
      }

/** Every shown phrase that is still void, resolved against the verified chain; saved markers are cleared here. */
export const pendingPhraseVoid = async (
  place: EnrollPlace,
  state: ChainState | null,
): Promise<PhraseVoidNotice | "unresolved" | null> => {
  const genesis = await genesisPhraseState(place, {
    intentPresent: await genesisIntentPresent(place),
    pinnedGenesisDigest: state?.pin?.genesisDigest ?? null,
  })
  if (genesis.kind === "void") return { purpose: "genesis" }
  const facts = chainFactsOf(state)
  for (const read of await listEnrollMarkers(place)) {
    if (read.kind === "corrupt") return "unresolved"
    const resolution = resolveEnrollMarker(read.marker, facts)
    if (resolution.kind === "void")
      return resolution.purpose === "rotate" ? { purpose: "rotate", oldStillValid: true } : { purpose: "enroll" }
    if (resolution.kind === "unresolved") return "unresolved"
    if (resolution.kind === "saved") await deleteEnrollMarker(place, read.marker.credentialId)
  }
  return null
}

// A passkey-only refusal from a phrase bridge means the bridge cannot run this ceremony at all.
const bridgeRefusal = (
  reason: "cancelled" | "no-prf" | "no-user-verification" | "not-survivable" | "credential-reused" | "device-wrap-refused",
): "cancelled" | "credential-reused" | "device-wrap-refused" | "unavailable" =>
  reason === "no-prf" || reason === "no-user-verification" || reason === "not-survivable" ? "unavailable" : reason

const drawCredentialId = (used: ReadonlySet<string>): string => {
  for (;;) {
    const id = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)))
    if (!used.has(id)) return id
  }
}

type Enrolled = { readonly credentialId: string; readonly seq: number; readonly place: EnrollPlace }

/**
 * A phrase recovery key enrolled from a member device (contract 6, A1.1-M4.3, M3). Under the genesis lock and in
 * this order: verified chain read; any undelivered void notice stops it (M2); the client flag and a fresh floor
 * read (refusal writes nothing); the engine draws the credential id; the non-secret marker; only then the words.
 * A cancel deletes the marker; any later failure keeps it, so the shown phrase reads void until acknowledged.
 */
const enrollUnderLock = async (
  input: PhraseEnrollInput,
  purpose: "enroll" | "rotate",
  oldCredentialId: string | undefined,
): Promise<Enrolled | Exclude<PhraseEnrollOutcome, { readonly ok: true }>> => {
  const place = { pinDir: input.pinDir, account: input.account, principalId: input.keyring.principal().id }
  const served = await loadServedChain(input.chain, input.account, input.rejections, input.anchor)
  if (!served.ok) return { ok: false, reason: served.reason === "anchor-mismatch" ? "unverified" : served.reason }
  const pending = await pendingPhraseVoid(place, served.state)
  if (pending === "unresolved") return { ok: false, reason: "unresolved" }
  if (pending !== null) return { ok: false, reason: "acknowledge-required", phraseVoid: pending }
  const refusal = await phraseCreationRefusal(input.phraseGate, input.account, input.chain)
  if (refusal !== null) return { ok: false, reason: "phrase-unavailable", why: refusal }
  const enrollPhrase = input.bridge.enrollPhrase
  if (enrollPhrase === undefined) return { ok: false, reason: "phrase-unavailable", why: "no-surface" }
  const { authority, head } = served.state
  const self = input.keyring.principal().id
  if (authority === null || head === null || authority.members.get(self)?.signing_public_key !== input.keyring.publicKeys().signing)
    return { ok: false, reason: "not-member" }
  const deviceWrap = committedWrap(served.state, authority.epoch, `device:${self}`)
  if (deviceWrap === null) return { ok: false, reason: "not-member" }
  if (authority.registry.size >= MAX_RECOVERY_KEYS) return { ok: false, reason: "too-many-recovery-keys" }
  const credentialId = drawCredentialId(authority.enrolledEver)
  await writeEnrollMarker(place, {
    version: 1,
    account: input.account,
    credentialId,
    purpose,
    ...(oldCredentialId === undefined ? {} : { oldCredentialId }),
    startedAt: Date.now(),
  })
  input.onCeremony?.("phrase")
  const enrolled = await enrollPhrase({
    account: input.account,
    credentialId,
    usedCredentialIds: [...authority.enrolledEver],
    custodyRoot: authority.custodyRoot,
    predecessor: head.keyring_link,
    epoch: authority.epoch,
    deviceWrap,
    expectedHistory: expectedHistory(authority, authority.epoch),
  })
  if (!enrolled.ok) {
    if (enrolled.reason === "cancelled") await deleteEnrollMarker(place, credentialId)
    return { ok: false, reason: bridgeRefusal(enrolled.reason) }
  }
  if (enrolled.key.credential_id !== credentialId || !isPhraseKey(enrolled.key)) return { ok: false, reason: "key-mismatch" }
  const body = {
    kind: "recovery-key",
    account: input.account,
    epoch: authority.epoch,
    ...enrolled.key,
    countersign: enrolled.countersign,
    wraps_digest: enrolled.wrapsDigest,
  }
  const appended = await input.chain.appendKeys(await signedAppend(input.keyring, head, body, [enrolled.wrap]))
  if (!appended.ok) {
    if (appended.reason === "phrase_keys_not_accepted") return { ok: false, reason: "phrase-unavailable", why: "service-floor-off" }
    return { ok: false, reason: appended.reason }
  }
  input.onEvent?.("sync.recovery.enrolled")
  return { credentialId, seq: appended.seq, place }
}

const lockOwner = (input: PhraseEnrollInput) => ({
  account: input.account,
  serviceDeviceId: "",
  keyring: input.keyring,
  pinDir: input.pinDir,
})

export const enrollPhraseRecoveryKey = (input: PhraseEnrollInput): Promise<PhraseEnrollOutcome> =>
  withGenesisLock(lockOwner(input), async () => {
    const result = await enrollUnderLock(input, "enroll", undefined)
    if (!("place" in result)) return result
    await deleteEnrollMarker(result.place, result.credentialId)
    return { ok: true, credentialId: result.credentialId, seq: result.seq }
  })

/**
 * "Create a new recovery phrase" (contract 6, F7(c)): enroll the new phrase, then remove the old key and rotate.
 * The old phrase is void only after both land; until then the outcome says it still works.
 */
export const rotateRecoveryPhrase = (
  input: PhraseEnrollInput & { readonly oldCredentialId: string },
): Promise<PhraseRotateOutcome> =>
  withGenesisLock(lockOwner(input), async () => {
    const result = await enrollUnderLock(input, "rotate", input.oldCredentialId)
    if (!("place" in result)) return { ...result, oldStillValid: true }
    const removed = await removeRecoveryKey({
      anchor: input.anchor,
      account: input.account,
      rpId: "",
      credentialId: input.oldCredentialId,
      confirmGivingUpRecovery: false,
      keyring: input.keyring,
      bridge: null,
      transport: input.chain,
      rejections: input.rejections,
      ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
    })
    if (!removed.ok) return { ok: false, reason: "rotation-pending", newSaved: true, oldStillValid: true }
    await deleteEnrollMarker(result.place, result.credentialId)
    return { ok: true, credentialId: result.credentialId, epoch: removed.epoch }
  })
