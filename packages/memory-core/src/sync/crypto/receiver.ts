import type { SyncEntry } from "./entry.ts"
import type { ChainEntry } from "./vendor/sync-format/chain.ts"
import { foldRefusal, type ReceiverRefusal } from "./vendor/sync-format/fold.ts"
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

/** A receiver refusal, or the receiver refusing an already-verified history entry instead of this one. */
export type ReceiverCheck = ReceiverRefusal | "receiver_seq_mismatch"

/**
 * The receiver's refusal of `entry` appended after the already-verified keyring `history`; null
 * only when the receiver accepts the whole list. A refusal at any other seq means the verified
 * history and the receiver disagree, which must never happen, so it refuses this entry too.
 */
export const receiverRefusal = async (
  history: ReadonlyArray<SyncEntry>,
  entry: SyncEntry,
): Promise<ReceiverCheck | null> => {
  const list = wire([...history, entry])
  const isFork = entry.kind === "keyring" && entry.body.kind === "fork-resolution"
  const received = isFork ? await receiveKeyringChain(list) : foldRefusal(list)
  if (received.ok) return null
  return received.seq === entry.seq ? received.reason : "receiver_seq_mismatch"
}
