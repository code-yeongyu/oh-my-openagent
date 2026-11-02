/**
 * The receiver's entry point (docs/sync-design.md sections 7 and 8.2): the fold's refusals, then
 * the proof of every fork-resolution's evidence, so no caller can take a fold whose evidence was
 * never verified. Returns the fold, or the first refused record and why.
 */
import type { AuthorityFold, ChainEntry } from "./chain.ts";
import {
  foldAuthority,
  foldRefusal,
  keyringFold,
  type ReceivedChain,
  type ReceiverRefusal,
} from "./fold.ts";
import { verifyForkEvidence } from "./fork-evidence.ts";

export const receiveKeyringChain = async (
  entries: ReadonlyArray<ChainEntry>,
): Promise<ReceivedChain> => {
  const folded = foldRefusal(entries);
  const refusedAt = folded.ok ? Number.POSITIVE_INFINITY : folded.seq;
  for (const entry of entries) {
    const evidence = entry.kind === "keyring" ? entry.body?.evidence : undefined;
    if (entry.seq >= refusedAt) break;
    if (entry.body?.kind !== "fork-resolution" || evidence === undefined) continue;
    const ancestry = entries.filter((e) => e.seq <= evidence.common.seq);
    if (!(await verifyForkEvidence(ancestry, evidence, foldAuthority))) {
      return { ok: false, seq: entry.seq, reason: "fork_evidence_invalid" };
    }
  }
  return folded;
};

/**
 * The receiver one entry at a time, for a client that checks each new entry after the history it
 * already accepted. The fold state carries from one call to the next, so receiving an entry does
 * not re-fold or re-verify the entries before it.
 */
export type KeyringReceiver = {
  /**
   * Receives `entry` after every entry accepted so far: null when it is accepted and folded in,
   * otherwise why it is refused. A refused entry changes nothing, so the receiver stays at the
   * last accepted entry. For any accepted history `h`, this refuses exactly what
   * `receiveKeyringChain([...h, entry])` refuses, with the same reason. Calls run in order.
   */
  readonly receive: (entry: ChainEntry) => Promise<ReceiverRefusal | null>;
  /** The authority folded from the accepted entries, as a copy. */
  readonly fold: () => AuthorityFold;
};

export const createKeyringReceiver = (): KeyringReceiver => {
  const state = keyringFold();
  const receiveOne = async (entry: ChainEntry): Promise<ReceiverRefusal | null> => {
    const refused = state.refusal(entry);
    if (refused !== null) return refused;
    const evidence = entry.kind === "keyring" ? entry.body?.evidence : undefined;
    if (entry.body?.kind === "fork-resolution" && evidence !== undefined) {
      const ancestry = state.through(evidence.common.seq);
      if (!(await verifyForkEvidence(ancestry, evidence, foldAuthority))) {
        return "fork_evidence_invalid";
      }
    }
    state.accept(entry);
    return null;
  };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    receive: (entry) => {
      const result = queue.then(() => receiveOne(entry));
      queue = result.catch(() => undefined);
      return result;
    },
    fold: () => {
      const { members, registry, cancelled } = state.fold();
      return {
        members: new Map(members),
        registry: new Map(registry),
        cancelled: new Set(cancelled),
      };
    },
  };
};
