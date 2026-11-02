/**
 * The keyring fold of docs/sync-design.md sections 7 and 8.2: membership and the recovery
 * registry computed from the chain alone, with every receiver check the fold depends on. A record
 * that fails a check is refused and never applied; `receiveKeyringChain` (receive.ts) reports
 * the first one.
 */

import {
  type Authority,
  apply,
  copyOf,
  doneThrough,
  doneWithDigest,
  type FoldState,
} from "./authority.ts";
import {
  assertCanonicalOrder,
  compareMembers,
  compareRecoveryKeys,
  compareWrapEntries,
} from "./canonical.ts";
import type { AuthorityFold, ChainEntry, ForkEvidence, ForkState, KeyringBody } from "./chain.ts";
import { branchRefusal } from "./fork-evidence.ts";
import { forkSetMatchesEvidence } from "./fork-set.ts";
import { recomputeForkStateWith } from "./fork-state.ts";
import { jcsCanonical } from "./jcs.ts";

export type ReceiverRefusal =
  | "noncanonical_order"
  | "recovery_author_not_join"
  | "veto_not_a_join"
  | "veto_signer_not_member"
  | "fork_set_mismatch"
  | "fork_common_unknown"
  | "fork_state_mismatch"
  | "fork_signer_not_member"
  | "fork_evidence_invalid"
  | "recovery_join_author"
  | "recovery_join_unenrolled"
  | "join_already_vetoed"
  | "batch_with_body"
  | "unknown_author_kind"
  | "seq_not_increasing";

export type ReceivedChain =
  | { readonly ok: true; readonly fold: AuthorityFold }
  | { readonly ok: false; readonly seq: number; readonly reason: ReceiverRefusal };

/** Checks a fork-resolution against its evidence and the chain so far; null when it holds. */
const forkRefusal = (
  entry: ChainEntry,
  body: KeyringBody,
  state: FoldState,
): ReceiverRefusal | null => {
  const { evidence, state: stated } = body;
  if (evidence === undefined || stated === undefined) return "fork_state_mismatch";
  if (!forkSetMatchesEvidence(body.fork_set ?? [], evidence.branches)) return "fork_set_mismatch";
  const branches = branchRefusal(evidence);
  if (branches !== null) return branches;
  if (!assertCanonicalOrder(stated.members, compareMembers)) return "noncanonical_order";
  if (!assertCanonicalOrder(stated.recovery_keys, compareRecoveryKeys)) return "noncanonical_order";
  const at = state.bySeq.get(evidence.common.seq);
  const common = at === undefined ? undefined : state.done[at];
  if (common === undefined || common.digest !== evidence.common.digest) {
    return "fork_common_unknown";
  }
  // A resolution re-folds the chain through its common ancestor once per branch: its cost is the
  // fork's, never paid by the entries around it.
  const ancestry = doneThrough(state, common.seq);
  // A branch record the receiver would refuse is not skipped: it refuses the whole evidence.
  for (const branch of evidence.branches) {
    if (!foldRefusal([...ancestry, ...branch.records]).ok) return "fork_evidence_invalid";
  }
  const recomputed = recomputeForkStateWith(foldAuthority, ancestry, evidence);
  if (jcsCanonical(recomputed) !== jcsCanonical(stated)) return "fork_state_mismatch";
  const signer = entry.author;
  if (signer.kind !== "device" || !stated.members.some((m) => m.id === signer.id)) {
    return "fork_signer_not_member";
  }
  return null;
};

/** Section 8.2 recovery-receiver rules 1 and 3: the named, enrolled credential signs the join. */
const joinRefusal = (
  entry: ChainEntry,
  body: KeyringBody,
  atEntry: Authority,
): ReceiverRefusal | null => {
  const { author } = entry;
  if (author.kind !== "recovery" || author.credential_id !== body.credential_id) {
    return "recovery_join_author";
  }
  return atEntry.registry.has(author.credential_id) ? null : "recovery_join_unenrolled";
};

const vetoRefusal = (
  entry: ChainEntry,
  body: KeyringBody,
  state: FoldState,
): ReceiverRefusal | null => {
  const join = doneWithDigest(state, body.join_digest);
  if (join?.body?.kind !== "recovery-join") return "veto_not_a_join";
  const signer = entry.author;
  if (signer.kind !== "device" || state.beforeJoin.get(join.seq)?.members.has(signer.id) !== true) {
    return "veto_signer_not_member";
  }
  return state.vetoed.has(join.digest) ? "join_already_vetoed" : null;
};

const refusalOf = (entry: ChainEntry, state: FoldState): ReceiverRefusal | null => {
  if (entry.seq <= state.lastSeq) return "seq_not_increasing";
  const authorKind: unknown = entry.author.kind;
  if (authorKind !== "device" && authorKind !== "recovery") return "unknown_author_kind";
  if (entry.kind === "batch" && entry.body !== undefined && entry.body !== null) {
    return "batch_with_body";
  }
  if (entry.wraps !== undefined && !assertCanonicalOrder(entry.wraps, compareWrapEntries)) {
    return "noncanonical_order";
  }
  const body = entry.kind === "keyring" ? (entry.body ?? null) : null;
  if (entry.author.kind === "recovery" && body?.kind !== "recovery-join") {
    return "recovery_author_not_join";
  }
  if (body === null) return null;
  if (body.kind === "rotation" && !assertCanonicalOrder(body.members ?? [], compareMembers)) {
    return "noncanonical_order";
  }
  if (body.kind === "recovery-join") return joinRefusal(entry, body, state.authority);
  if (body.kind === "recovery-join-vetoed") return vetoRefusal(entry, body, state);
  return body.kind === "fork-resolution" ? forkRefusal(entry, body, state) : null;
};

/**
 * The keyring fold as a state machine over one entry at a time: `refusal` checks an entry
 * against the entries accepted so far without changing anything, `accept` folds an entry the
 * check accepted in, and `pass` records a refused entry's seq so a later replay of it is refused.
 * Checking and folding one entry costs the same however long the chain before it is; only a
 * veto (which cancels the records after its join) and a fork-resolution (which re-folds its
 * branches from the common ancestor) do work in proportion to what they name.
 */
export type KeyringFold = {
  readonly refusal: (entry: ChainEntry) => ReceiverRefusal | null;
  readonly accept: (entry: ChainEntry) => void;
  readonly pass: (entry: ChainEntry) => void;
  /** The accepted entries through an accepted seq: a fork-resolution's ancestry. */
  readonly through: (seq: number) => ReadonlyArray<ChainEntry>;
  /** The authority folded so far; live, so a caller that keeps it copies it. */
  readonly fold: () => AuthorityFold;
};

export const keyringFold = (): KeyringFold => {
  const state: FoldState = {
    authority: { members: new Map(), registry: new Map() },
    cancelled: new Set(),
    done: [],
    byDigest: new Map(),
    bySeq: new Map(),
    beforeJoin: new Map(),
    vetoed: new Set(),
    lastSeq: 0,
  };
  const pass = (entry: ChainEntry): void => {
    state.lastSeq = Math.max(state.lastSeq, entry.seq);
  };
  const accept = (entry: ChainEntry): void => {
    pass(entry);
    const body = entry.kind === "keyring" ? (entry.body ?? null) : null;
    if (body?.kind === "recovery-join") state.beforeJoin.set(entry.seq, copyOf(state.authority));
    if (body !== null) state.authority = apply(state, body);
    if (body?.kind === "recovery-join-vetoed" && body.join_digest !== undefined) {
      state.vetoed.add(body.join_digest);
    }
    const at = state.done.push(entry) - 1;
    state.bySeq.set(entry.seq, at);
    if (!state.byDigest.has(entry.digest)) state.byDigest.set(entry.digest, at);
  };
  return {
    refusal: (entry) => refusalOf(entry, state),
    accept,
    pass,
    through: (seq) => doneThrough(state, seq),
    fold: () => ({ ...state.authority, cancelled: state.cancelled }),
  };
};

const walk = (
  entries: ReadonlyArray<ChainEntry>,
): { readonly fold: AuthorityFold; readonly refused: ReceivedChain | null } => {
  const fold = keyringFold();
  let refused: ReceivedChain | null = null;
  for (const entry of entries) {
    const reason = fold.refusal(entry);
    if (reason === null) {
      fold.accept(entry);
      continue;
    }
    refused ??= { ok: false, seq: entry.seq, reason };
    fold.pass(entry);
  }
  return { fold: fold.fold(), refused };
};

/**
 * Folds keyring entries in sequence order: genesis seeds; approvals add; rotations replace the
 * membership; a recovery-join resets both sets to the joined principal and the used key; a veto
 * restores the join's predecessor minus the used key and cancels every record after the join; a
 * fork-resolution takes its recomputed state. Refused records change nothing.
 */
export const foldAuthority = (entries: ReadonlyArray<ChainEntry>): AuthorityFold =>
  walk(entries).fold;

/** The fold's own refusals (everything but the async evidence proof): see receive.ts. */
export const foldRefusal = (entries: ReadonlyArray<ChainEntry>): ReceivedChain => {
  const { fold, refused } = walk(entries);
  return refused ?? { ok: true, fold };
};

/** Section 8.2's recomputation of a resolution's state from the chain through its ancestor. */
export const recomputeForkState = (
  ancestry: ReadonlyArray<ChainEntry>,
  evidence: ForkEvidence,
): ForkState => recomputeForkStateWith(foldAuthority, ancestry, evidence);
