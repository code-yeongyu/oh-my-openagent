import { type AnchorRejection, anchorStep, type ChainAnchor, isBootstrapAnchor, isPinCandidate, isTrustAnchor, type PinCandidate } from "./anchor.ts"
import type { BatchEntry, Head, KeyringEntry, SyncEntry, VerifiedKeyringEntry, VerifiedWrap } from "./entry.ts"
import { type EnvelopeRejection, envelopeRefusal } from "./envelope.ts"
import { frozenCopy } from "./frozen.ts"
import { type Authority, applyRecord, type FoldedRecord, isCancelledAdmission, isVetoedEpoch } from "./fold.ts"
import { expectedEpoch, forcedRotationRefusal, keyWithinEpoch, type LinkMode, linksHold, signerKey } from "./chain-checks.ts"
import { type ParsedBody, parseBody } from "./parse.ts"
import type { RejectionCounter } from "./rejection.ts"
import { type ReceiverCheck, type ReceiverPass, receiverPass } from "./receiver.ts"
import { checkRecordRules, type RuleRejection } from "./rules.ts"
import { authorSigningKey, verifyRecordSig } from "./signatures.ts"

export type { LinkMode }
import { jcsBytes, sha256B64 } from "./vendor/sync-format/jcs.ts"

export type ChainRejection =
  | RuleRejection
  | ReceiverCheck
  | EnvelopeRejection
  | AnchorRejection
  | "forced_rotation_required"
  | "untrusted_state"
  | "bad_fork_resolution"
  | "bad_record"
  | "link_mismatch"
  | "not_member"
  | "bad_signature"
  | "epoch_mismatch"
  | "account_mismatch"
  | "digest_mismatch"

declare const chainStateBrand: unique symbol

type ChainFields = {
  readonly account: string
  readonly head: Head | null
  readonly authority: Authority | null
  readonly history: ReadonlyArray<FoldedRecord>
  /** Every verified keyring entry of an ANCHORED chain, wraps minted: the merged receiver re-reads them. */
  readonly received: ReadonlyArray<VerifiedKeyringEntry>
  /** The device's trust anchor; nothing is trusted and no wrap is minted until the chain meets it. */
  readonly anchor: ChainAnchor
  readonly anchored: boolean
  /** Verified keyring entries walked before the anchor was met: never minted, never handed out. */
  readonly unanchored: ReadonlyArray<KeyringEntry>
  readonly genesisDigest: string | null
  /** The root a bootstrap walk proved, for the pin store; null for a chain walked under a pin. */
  readonly pin: PinCandidate | null
  /** The seq of a fork-resolution whose forced rotation must come next (spec 8.2), else null. */
  readonly forcedRotationAfter: number | null
}

/** A verified chain position; only this module mints one, so a state built or copied elsewhere is refused. */
export type ChainState = ChainFields & { readonly [chainStateBrand]: true }

const states = new WeakSet<object>()

export const isChainState = (value: unknown): value is ChainState => typeof value === "object" && value !== null && states.has(value)

const isState = (value: object): value is ChainState => states.has(value)

const branded = (value: object): boolean => isVerifiedWrap(value) || isTrustAnchor(value) || isBootstrapAnchor(value) || isPinCandidate(value)

const mintState = (fields: ChainFields): ChainState => {
  const state = frozenCopy({ ...fields }, branded)
  states.add(state)
  if (!isState(state)) throw new Error("unreachable: a fresh chain state is always registered")
  return state
}

const minted = new WeakSet<object>()

const isMinted = (wrap: object): wrap is VerifiedWrap => minted.has(wrap)

/** True only for a wrap this module minted from a verified keyring entry, never for a copy. */
export const isVerifiedWrap = (wrap: unknown): wrap is VerifiedWrap =>
  typeof wrap === "object" && wrap !== null && isMinted(wrap)

const mintWraps = (entry: KeyringEntry): VerifiedKeyringEntry => ({
  ...entry,
  wraps: entry.wraps
    .map((wrap) => {
      const sealed = Object.freeze({ epoch: wrap.epoch, id: wrap.id, wrap: wrap.wrap, account: entry.account })
      minted.add(sealed)
      return sealed
    })
    .filter(isMinted),
})

export type AcceptedBatch = {
  readonly seq: number
  readonly digest: string
  readonly epoch: number
  readonly authorId: string
  readonly signingPublicKey: string
}

export type ChainStep =
  | { readonly kind: "keyring"; readonly seq: number; readonly record: ParsedBody["kind"] }
  | { readonly kind: "batch"; readonly batch: AcceptedBatch }
  | { readonly kind: "vetoed"; readonly seq: number }

export type AppendOutcome =
  | { readonly ok: true; readonly state: ChainState; readonly steps: ReadonlyArray<ChainStep> }
  | {
      readonly ok: false
      readonly state: ChainState
      readonly steps: ReadonlyArray<ChainStep>
      readonly seq: number
      readonly reason: ChainRejection
    }

export const emptyChain = (account: string, anchor: ChainAnchor): ChainState =>
  mintState({
  account,
  head: null,
  authority: null,
  history: [],
  received: [],
  anchor,
  anchored: false,
  unanchored: [],
  genesisDigest: null,
  pin: null,
  forcedRotationAfter: null,
  })

/**
 * Moves an anchored state's head forward to a snapshot position whose keyring head is the one this
 * state verified (snapshot import only); any other position, or an unanchored state, gets null. At
 * the same seq the head may not move sideways: only the verified link itself is accepted there.
 */
export const atVerifiedHead = (state: ChainState, head: Head): ChainState | null => {
  if (!isChainState(state) || !state.anchored || state.head === null) return null
  if (head.keyring_link !== state.head.keyring_link || head.seq < state.head.seq) return null
  if (head.seq === state.head.seq && head.link !== state.head.link) return null
  return mintState({ ...state, head })
}

const seenKeyring = (state: ChainState): ReadonlyArray<KeyringEntry> => [...state.received, ...state.unanchored]

type StepResult =
  | { readonly ok: true; readonly state: ChainState; readonly step: ChainStep }
  | { readonly ok: false; readonly reason: ChainRejection }

/**
 * One keyring record through the receiver order of sync-design section 6: chain link,
 * record signature (against the authority folded from every earlier keyring record),
 * epoch, account binding, the per-kind rules of the section 8.2 verifier table, and
 * finally the content hash. Right after the link, the merged receiver's own refusals apply, so a
 * record it refuses is never folded here either.
 */
export const verifyKeyringEntry = async (
  state: ChainState,
  entry: KeyringEntry,
  mode: LinkMode,
  pass?: ReceiverPass,
): Promise<StepResult> => {
  const malformed = envelopeRefusal(entry)
  if (malformed !== null) return { ok: false, reason: malformed }
  if (!isChainState(state)) return { ok: false, reason: "untrusted_state" }
  if (state.anchor.account !== state.account) return { ok: false, reason: "untrusted_root" }
  if (!(await linksHold(state.head, entry, mode))) return { ok: false, reason: "link_mismatch" }
  const refused = (pass ?? (await receiverPass(seenKeyring(state), [entry])))(entry)
  if (refused !== null) return { ok: false, reason: refused }
  const body = parseBody(entry.body)
  if (body === null) return { ok: false, reason: "bad_record" }
  const before = state.authority
  const key = signerKey(body, before, entry.author, state.history)
  if (key === null) return { ok: false, reason: "not_member" }
  if (!(await verifyRecordSig(key, entry))) return { ok: false, reason: "bad_signature" }
  if (entry.epoch !== expectedEpoch(body, before) || entry.body.epoch !== entry.epoch) {
    return { ok: false, reason: "epoch_mismatch" }
  }
  if (entry.account !== state.account || entry.body.account !== state.account) {
    return { ok: false, reason: "account_mismatch" }
  }
  const predecessor = state.head === null ? "" : state.head.keyring_link
  const ruleFailure = await checkRecordRules(entry, body, before, state.history, predecessor)
  if (ruleFailure !== null) return { ok: false, reason: ruleFailure }
  if ((await sha256B64(jcsBytes(entry.body))) !== entry.digest) return { ok: false, reason: "digest_mismatch" }
  const forced = forcedRotationRefusal(state.forcedRotationAfter, body)
  if (forced !== null) return { ok: false, reason: forced }
  const genesisDigest = body.kind === "genesis" ? entry.digest : state.genesisDigest
  const met = state.anchored ? null : anchorStep(state.anchor, entry, body, before, genesisDigest ?? "")
  if (met !== null && !met.ok) return { ok: false, reason: met.reason }
  const record: FoldedRecord = { seq: entry.seq, digest: entry.digest, body, before }
  const authority = applyRecord(state.history, record)
  if (authority === null) return { ok: false, reason: "bad_record" }
  const anchored = state.anchored || met?.anchored === true
  return {
    ok: true,
    state: mintState({
      ...state,
      head: { seq: entry.seq, link: entry.link, keyring_link: entry.keyring_link },
      authority,
      history: [...state.history, record],
      received: anchored ? [...state.received, ...[...state.unanchored, entry].map(mintWraps)] : state.received,
      anchored,
      unanchored: anchored ? [] : [...state.unanchored, entry],
      genesisDigest,
      pin: met?.ok === true && met.candidate !== null ? met.candidate : state.pin,
      forcedRotationAfter: body.kind === "fork-resolution" ? entry.seq : null,
    }),
    step: { kind: "keyring", seq: entry.seq, record: body.kind },
  }
}

const verifyBatchEntry = async (state: ChainState, entry: BatchEntry, pass: ReceiverPass): Promise<StepResult> => {
  const malformed = envelopeRefusal(entry)
  if (malformed !== null) return { ok: false, reason: malformed }
  if (!isChainState(state)) return { ok: false, reason: "untrusted_state" }
  if (!(await linksHold(state.head, entry, "main"))) return { ok: false, reason: "link_mismatch" }
  const refused = pass(entry)
  if (refused !== null) return { ok: false, reason: refused }
  const forced = forcedRotationRefusal(state.forcedRotationAfter, null)
  if (forced !== null) return { ok: false, reason: forced }
  const authority = state.authority
  const head = state.head
  if (authority === null || head === null || entry.author.kind !== "device") return { ok: false, reason: "not_member" }
  const next = mintState({ ...state, head: { seq: entry.seq, link: entry.link, keyring_link: head.keyring_link } })
  const authorId = entry.author.id
  const vetoed = isVetoedEpoch(authority, entry.epoch) || isCancelledAdmission(authority, authorId)
  const key = vetoed ? keyWithinEpoch(state.history, state.authority, entry.author, entry.epoch) : authorSigningKey(authority, entry.author)
  if (key === null) return { ok: false, reason: "not_member" }
  if (!(await verifyRecordSig(key, entry))) return { ok: false, reason: "bad_signature" }
  if (entry.account !== state.account) return { ok: false, reason: "account_mismatch" }
  if (vetoed) return { ok: true, state: next, step: { kind: "vetoed", seq: entry.seq } }
  if (entry.epoch !== authority.epoch) return { ok: false, reason: "epoch_mismatch" }
  const batch: AcceptedBatch = { seq: entry.seq, digest: entry.digest, epoch: entry.epoch, authorId, signingPublicKey: key }
  return { ok: true, state: next, step: { kind: "batch", batch } }
}

/**
 * Extends the local verified chain entry by entry. The first refused entry stops the walk,
 * counts one content-free rejection and leaves the state at the last verified entry;
 * vetoed-epoch batches advance the cursor without being applied. A walk that does not meet the
 * device's trust anchor hands out nothing: it is refused as a whole (`unanchored`, or the anchor
 * refusal itself) and the input state comes back unchanged, with no steps and no minted wrap.
 */
export const appendEntries = async (
  state: ChainState,
  entries: ReadonlyArray<SyncEntry>,
  rejections: RejectionCounter,
): Promise<AppendOutcome> => {
  const steps: ChainStep[] = []
  if (!isChainState(state)) {
    rejections.record("untrusted_state")
    return { ok: false, state, steps, seq: 0, reason: "untrusted_state" }
  }
  let current = state
  const pass = await receiverPass(seenKeyring(state), entries)
  for (const entry of entries) {
    const malformed = envelopeRefusal(entry)
    const result: StepResult =
      malformed !== null
        ? { ok: false, reason: malformed }
        : entry.kind === "keyring"
          ? await verifyKeyringEntry(current, entry, "main", pass)
          : await verifyBatchEntry(current, entry, pass)
    if (!result.ok) {
      rejections.record(result.reason)
      const seq = malformed === null && Number.isSafeInteger(entry.seq) ? entry.seq : (current.head?.seq ?? 0) + 1
      return current.anchored
        ? { ok: false, state: current, steps, seq, reason: result.reason }
        : { ok: false, state, steps: [], seq, reason: result.reason }
    }
    current = result.state
    steps.push(result.step)
  }
  if (!current.anchored) {
    rejections.record("unanchored")
    return { ok: false, state, steps: [], seq: (current.head?.seq ?? 0) + 1, reason: "unanchored" }
  }
  return { ok: true, state: current, steps }
}
