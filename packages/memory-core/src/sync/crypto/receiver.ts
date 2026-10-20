import type { SyncEntry } from "./entry.ts"
import { frozenCopy } from "./frozen.ts"
import type { ChainEntry } from "./vendor/sync-format/chain.ts"
import { envelopeRefusal } from "./envelope.ts"
import { foldRefusal, type ReceivedChain, type ReceiverRefusal } from "./vendor/sync-format/fold.ts"
import { receiveKeyringChain } from "./vendor/sync-format/receive.ts"

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

/** The receiver's verdict for one entry of the pull a ReceiverPass was built for. */
export type ReceiverPass = (entry: SyncEntry) => ReceiverCheck | null

const firstRefusalAt = (received: ReceivedChain, entry: SyncEntry, ours: ReadonlySet<number>): ReceiverCheck | null => {
  if (received.ok || received.seq > entry.seq) return null
  return received.seq === entry.seq && ours.has(received.seq) ? received.reason : "receiver_seq_mismatch"
}

/**
 * The merged receiver run ONCE over the already-verified keyring `history` and the keyring entries of
 * `entries`, in order, up to the first malformed one or the first whose seq does not increase. Every seq in
 * that walk names exactly one entry, so the receiver's first refusal (reported by seq) names one entry too:
 * entries before it pass, it gets the reason, and nothing after it is ever reached. That equals running each
 * entry over the history plus every earlier entry of the pull, because the fold judges a record only by the
 * records before it; so a pull costs one pass, not one pass per entry. An entry whose seq does not increase
 * gets the receiver's own `seq_not_increasing`, and nothing after it joins the walk.
 * A batch entry's receiver checks read only its own fields and the sequence order, so it is folded alone
 * and its seq is compared with the last keyring seq before it. An entry the pass was not built for is refused.
 */
export const receiverPass = async (history: ReadonlyArray<SyncEntry>, entries: ReadonlyArray<SyncEntry>): Promise<ReceiverPass> => {
  const keyring: SyncEntry[] = []
  const lastSeqBefore = new Map<SyncEntry, number>()
  let replayed: SyncEntry | null = null
  let lastSeq = history.reduce((max, entry) => Math.max(max, entry.seq), 0)
  for (const entry of entries) {
    if (envelopeRefusal(entry) !== null) break
    if (entry.kind === "keyring") {
      if (entry.seq <= lastSeq) {
        replayed = entry
        break
      }
      keyring.push(entry)
      lastSeq = Math.max(lastSeq, entry.seq)
    } else {
      lastSeqBefore.set(entry, lastSeq)
    }
  }
  const list = [...history.map(wireOnce), ...wire(keyring)]
  const hasFork = keyring.some((entry) => entry.kind === "keyring" && entry.body.kind === "fork-resolution")
  const received = hasFork ? await receiveKeyringChain(list) : foldRefusal(list)
  const ours = new Set(keyring.map((entry) => entry.seq))
  const inPull = new Set<SyncEntry>(keyring)
  return (entry) => {
    if (inPull.has(entry)) return firstRefusalAt(received, entry, ours)
    if (entry === replayed) return received.ok ? "seq_not_increasing" : "receiver_seq_mismatch"
    const before = lastSeqBefore.get(entry)
    if (before === undefined) return "receiver_seq_mismatch"
    if (entry.seq <= before) return "seq_not_increasing"
    return firstRefusalAt(foldRefusal(wire([entry])), entry, new Set([entry.seq]))
  }
}

/**
 * The test oracle for receiverPass: the receiver's refusal of `entry` appended after the already-verified
 * keyring `history`, by folding the whole list; null only when the receiver accepts the whole list. A refusal at any other seq means the verified history and the
 * receiver disagree, which must never happen, so it refuses this entry too.
 */
export const receiverRefusal = async (history: ReadonlyArray<SyncEntry>, entry: SyncEntry): Promise<ReceiverCheck | null> => {
  const list = [...history.map(wireOnce), ...wire([entry])]
  const isFork = entry.kind === "keyring" && entry.body.kind === "fork-resolution"
  return firstRefusalAt(isFork ? await receiveKeyringChain(list) : foldRefusal(list), entry, new Set([entry.seq]))
}
