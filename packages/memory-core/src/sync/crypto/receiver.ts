import type { SyncEntry } from "./entry.ts"
import { frozenCopy } from "./frozen.ts"
import type { ChainEntry } from "./vendor/sync-format/chain.ts"
import { foldRefusal, type ReceivedChain, type ReceiverRefusal } from "./vendor/sync-format/fold.ts"
import { createKeyringReceiver, receiveKeyringChain } from "./vendor/sync-format/receive.ts"

/**
 * The merged omo-service receiver (vendored sync-format), run over the client's entries so the
 * client refuses exactly what the server's reference receiver refuses (sync-design 8.2): canonical
 * member and wrap order, recovery-join author and enrolment, one veto per join, batch rows without
 * bodies, monotonic sequence, and every fork-resolution's branches and evidence proof.
 *
 * The entries cross as their wire JSON: the receiver reads the transport shape and validates
 * every field it uses itself.
 */
export const wire = (entries: ReadonlyArray<SyncEntry>): ReadonlyArray<ChainEntry> => JSON.parse(JSON.stringify(entries))

const wired = new WeakMap<SyncEntry, ChainEntry>()

/**
 * One entry's wire form, made once per verified entry and frozen, so checking a new entry does not
 * re-serialize the whole verified history before it. The cache is keyed by identity, so the history
 * passed to receiverRefusal must hold only verified, frozen entries that can never change.
 */
const wireOnce = (entry: SyncEntry): ChainEntry => {
  const known = wired.get(entry)
  if (known !== undefined) return known
  const [fresh] = wire([entry])
  if (fresh === undefined) throw new Error("unreachable: one entry wires to one entry")
  const frozen = frozenCopy(fresh, () => false)
  wired.set(entry, frozen)
  return frozen
}

/** A receiver refusal, or the receiver refusing an already-verified history entry instead of this one. */
export type ReceiverCheck = ReceiverRefusal | "receiver_seq_mismatch"

const firstRefusalAt = (received: ReceivedChain, entry: SyncEntry, ours: ReadonlySet<number>): ReceiverCheck | null => {
  if (received.ok || received.seq > entry.seq) return null
  return received.seq === entry.seq && ours.has(received.seq) ? received.reason : "receiver_seq_mismatch"
}

/** The merged receiver positioned right after an already-verified keyring history. */
export type HistoryReceiver = {
  /**
   * The receiver's verdict for the next keyring entry. On null the receiver has folded the entry in, so
   * it now belongs only to the state that goes on to verify that entry; any other caller drops it.
   */
  readonly keyring: (entry: SyncEntry) => Promise<ReceiverCheck | null>
  /**
   * The verdict for a batch entry after the history. A batch's receiver checks read only its own fields
   * and the sequence order, so it is folded alone and its seq is compared with the last keyring seq; it
   * never moves the receiver.
   */
  readonly batch: (entry: SyncEntry) => ReceiverCheck | null
}

/**
 * The vendored incremental receiver folded once over `history`. If it refuses a verified history entry,
 * the client and the receiver disagree, which must never happen, so every later entry is refused too.
 */
const positionedAfter = async (history: ReadonlyArray<SyncEntry>): Promise<HistoryReceiver> => {
  const receiver = createKeyringReceiver()
  let agrees = true
  let lastSeq = 0
  for (const entry of history) {
    if ((await receiver.receive(wireOnce(entry))) !== null) {
      agrees = false
      break
    }
    lastSeq = entry.seq
  }
  return {
    keyring: async (entry) => {
      const [wired] = wire([entry])
      if (!agrees || wired === undefined) return "receiver_seq_mismatch"
      const refused = await receiver.receive(wired)
      if (refused === null) lastSeq = entry.seq
      return refused
    },
    batch: (entry) => {
      if (!agrees) return "receiver_seq_mismatch"
      if (entry.seq <= lastSeq) return "seq_not_increasing"
      return firstRefusalAt(foldRefusal(wire([entry])), entry, new Set([entry.seq]))
    },
  }
}

const held = new WeakMap<object, HistoryReceiver>()

/**
 * The receiver positioned after `history`, the keyring entries `owner` (a verified chain state) has
 * verified. A receiver the owner holds is taken, so no second state can move it, and checking one new
 * entry then costs the same at any chain length; an owner holding none gets one folded over `history`
 * once. Only four states hold none: a fresh state (empty history), an older state reused after its
 * receiver moved on to the state after it (no production caller does this), the state left by an
 * entry the receiver accepted but the client then refused (the receiver cannot be rewound), and a
 * state whose receiver `passReceiver` moved to a copy (no production caller reuses it). Each of
 * these refolds once, then appends cost the same again.
 */
export const takeReceiver = async (owner: object, history: ReadonlyArray<SyncEntry>): Promise<HistoryReceiver> => {
  const kept = held.get(owner)
  if (kept === undefined) return positionedAfter(history)
  held.delete(owner)
  return kept
}

/**
 * Moves the receiver `from` holds to `to`, a state with the same verified keyring history, so a copy
 * that only moves the head does not refold it. `from` holds none afterwards. Call it only when `to`
 * has exactly `from`'s verified keyring history (as `atVerifiedHead` guarantees): it does not check
 * this, and a receiver handed to a state with another history would judge entries against the wrong one.
 */
export const passReceiver = (from: object, to: object): void => {
  const kept = held.get(from)
  if (kept === undefined) return
  held.delete(from)
  held.set(to, kept)
}

/** Hands `receiver` to `owner`, the verified chain state whose keyring history it is positioned after. */
export const holdReceiver = (owner: object, receiver: HistoryReceiver): void => {
  held.set(owner, receiver)
}

/**
 * The test oracle for the incremental receiver: the receiver's refusal of `entry` appended after the already-verified
 * keyring `history`, by folding the whole list; null only when the receiver accepts the whole list. A refusal at any other seq means the verified history and the
 * receiver disagree, which must never happen, so it refuses this entry too.
 */
export const receiverRefusal = async (history: ReadonlyArray<SyncEntry>, entry: SyncEntry): Promise<ReceiverCheck | null> => {
  const list = [...history.map(wireOnce), ...wire([entry])]
  const isFork = entry.kind === "keyring" && entry.body.kind === "fork-resolution"
  return firstRefusalAt(isFork ? await receiveKeyringChain(list) : foldRefusal(list), entry, new Set([entry.seq]))
}
