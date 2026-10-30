import { appendEntries, type ChainState, emptyChain } from "../chain.ts"
import type { Head, KeyringBody, KeyringEntry, WrapEntry } from "../entry.ts"
import { wrapSetDigest } from "../links.ts"
import { createRejectionCounter } from "../rejection.ts"
import { wire } from "../receiver.ts"
import type { ForkEvidence, RecordRef } from "../vendor/sync-format/chain.ts"
import { recomputeForkState } from "../vendor/sync-format/fold.ts"
import { compareRecordRef } from "../vendor/sync-format/fork-set.ts"
import type { JsonValue } from "../vendor/sync-format/jcs.ts"
import { ACCOUNT, appendKeyring, chain, keyringFor, keys, principalKeys, record, fixtureAnchor } from "./sync-v1.test-support.ts"

/**
 * A two-branch fork built from the fixture keys over the real ancestry (genesis through
 * post_join_rotation): the recovered device rotates on two branches at seq 7, each with a wrap set
 * the client can verify, and a resolution states the authority the vendored receiver recomputes.
 * The golden fork vector ships no wraps for its branch rotations, so a wrap-verifying client cannot
 * walk it; this one it can.
 */
export type BuiltFork = {
  readonly ancestry: ReadonlyArray<KeyringEntry>
  readonly branchA: KeyringEntry
  readonly branchB: KeyringEntry
  /** The resolution after branch A's tip; `tamper` may change its evidence (as JSON) before signing. */
  readonly resolution: (tamper?: (evidence: EvidenceJson) => EvidenceJson) => Promise<KeyringEntry>
}

type EvidenceJson = { readonly branches: Array<{ readonly records: Array<Record<string, JsonValue>> }> } & Record<string, JsonValue>

const json = <T,>(value: unknown): T => JSON.parse(JSON.stringify(value))

const ref = (entry: KeyringEntry): RecordRef => ({ seq: entry.seq, digest: entry.digest, keyring_link: entry.keyring_link })

const verifiedState = async (entries: ReadonlyArray<KeyringEntry>): Promise<ChainState> => {
  const outcome = await appendEntries(emptyChain(ACCOUNT, fixtureAnchor()), entries, createRejectionCounter())
  if (!outcome.ok) throw new Error(`fork ancestry refused at seq ${outcome.seq}: ${outcome.reason}`)
  return outcome.state
}

const headOf = (state: ChainState): Head => {
  if (state.head === null) throw new Error("empty ancestry")
  return state.head
}

/** The recovered device's rotation after `state`; `forkResolution` is the seq a forced rotation names. */
export const rotation = async (state: ChainState, fill: string, forkResolution: number | null = null): Promise<KeyringEntry> => {
  const before = state.authority
  if (before === null) throw new Error("no authority")
  const recovered = { id: keys.devices.recovered.principal.id, ...principalKeys(keyringFor("recovered")) }
  const epoch = before.epoch + 1
  const recipients = [`device:${recovered.id}`, ...[...before.registry.keys()].map((id) => `recovery:${id}`)]
  const wraps: WrapEntry[] = recipients.sort().map((id) => ({ epoch, id, wrap: fill.repeat(43) }))
  const set = await wrapSetDigest(wraps)
  if (!set.ok) throw new Error("wrap set")
  const body: KeyringBody = {
    kind: "rotation",
    account: ACCOUNT,
    epoch,
    fork_resolution: forkResolution,
    members: [{ kind: "device", ...recovered }],
    wraps_digest: set.digest,
  }
  return appendKeyring(headOf(state), body, { keyring: keyringFor("recovered") }, wraps)
}

export const buildFork = async (): Promise<BuiltFork> => {
  const ancestry = chain.main.slice(0, chain.main.indexOf("post_join_rotation") + 1).map(record)
  const atCommon = await verifiedState(ancestry)
  const [branchA, branchB] = [await rotation(atCommon, "A"), await rotation(atCommon, "B")].sort((x, y) =>
    compareRecordRef(ref(x), ref(y)),
  )
  if (branchA === undefined || branchB === undefined) throw new Error("two branches")
  const common = ancestry.at(-1)
  if (common === undefined) throw new Error("no common ancestor")
  const atTip = await verifiedState([...ancestry, branchA])
  const resolution = async (tamper: (evidence: EvidenceJson) => EvidenceJson = (e) => e): Promise<KeyringEntry> => {
    const proof: ForkEvidence = {
      common: ref(common),
      branches: [branchA, branchB].map((tip) => ({ tip: ref(tip), records: wire([{ ...tip, wraps: [] }]) })),
    }
    const state = recomputeForkState(wire(ancestry), proof)
    const body: KeyringBody = {
      kind: "fork-resolution",
      account: ACCOUNT,
      epoch: state.epoch,
      fork_set: json<JsonValue>([branchA, branchB].map(ref)),
      evidence: json<JsonValue>(tamper(json<EvidenceJson>(proof))),
      continuation: json<JsonValue>(ref(branchA)),
      state: json<JsonValue>(state),
      merged_digest: branchA.digest,
    }
    return appendKeyring(headOf(atTip), body, { keyring: keyringFor("recovered") })
  }
  return { ancestry, branchA, branchB, resolution }
}
