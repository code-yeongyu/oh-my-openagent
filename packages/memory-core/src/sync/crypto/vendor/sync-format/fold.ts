/**
 * The keyring fold of docs/sync-design.md sections 7 and 8.2: membership and the recovery
 * registry computed from the chain alone, with every receiver check the fold depends on. A record
 * that fails a check is refused and never applied; `receiveKeyringChain` (receive.ts) reports
 * the first one.
 */
import {
  assertCanonicalOrder,
  compareMembers,
  compareRecoveryKeys,
  compareWrapEntries,
} from "./canonical.ts";
import type {
  AuthorityFold,
  ChainEntry,
  ForkEvidence,
  ForkState,
  KeyringBody,
  SyncPrincipal,
  SyncRecoveryKey,
} from "./chain.ts";
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

type Authority = { members: Map<string, SyncPrincipal>; registry: Map<string, SyncRecoveryKey> };

const readStringField = (body: KeyringBody, key: string): string => {
  const value: unknown = Reflect.get(body, key);
  return typeof value === "string" ? value : "";
};

const enrolledKey = (body: KeyringBody, credentialId: string): SyncRecoveryKey => ({
  credential_id: credentialId,
  rp_id: readStringField(body, "rp_id"),
  enrollment_nonce: readStringField(body, "enrollment_nonce"),
  sealing_public_key: readStringField(body, "sealing_public_key"),
  signing_public_key: readStringField(body, "signing_public_key"),
  survivable: Reflect.get(body, "survivable") === "roaming" ? "roaming" : "synced",
});

const authorityOf = (state: ForkState): Authority => ({
  members: new Map(state.members.map((member) => [member.id, member])),
  registry: new Map(state.recovery_keys.map((key) => [key.credential_id, key])),
});

/** Checks a fork-resolution against its evidence and the chain so far; null when it holds. */
const forkRefusal = (
  entry: ChainEntry,
  body: KeyringBody,
  done: ReadonlyArray<ChainEntry>,
): ReceiverRefusal | null => {
  const { evidence, state } = body;
  if (evidence === undefined || state === undefined) return "fork_state_mismatch";
  if (!forkSetMatchesEvidence(body.fork_set ?? [], evidence.branches)) return "fork_set_mismatch";
  const branches = branchRefusal(evidence);
  if (branches !== null) return branches;
  if (!assertCanonicalOrder(state.members, compareMembers)) return "noncanonical_order";
  if (!assertCanonicalOrder(state.recovery_keys, compareRecoveryKeys)) return "noncanonical_order";
  const common = done.find(
    (e) => e.seq === evidence.common.seq && e.digest === evidence.common.digest,
  );
  if (common === undefined) return "fork_common_unknown";
  const ancestry = done.filter((e) => e.seq <= common.seq);
  // A branch record the receiver would refuse is not skipped: it refuses the whole evidence.
  for (const branch of evidence.branches) {
    if (!foldRefusal([...ancestry, ...branch.records]).ok) return "fork_evidence_invalid";
  }
  const recomputed = recomputeForkStateWith(foldAuthority, ancestry, evidence);
  if (jcsCanonical(recomputed) !== jcsCanonical(state)) return "fork_state_mismatch";
  const signer = entry.author;
  if (signer.kind !== "device" || !state.members.some((m) => m.id === signer.id)) {
    return "fork_signer_not_member";
  }
  return null;
};

/** Section 8.2 recovery-receiver rules 1 and 3: the named, enrolled credential signs the join. */
const joinRefusal = (
  entry: ChainEntry,
  body: KeyringBody,
  atEntry: Authority | undefined,
): ReceiverRefusal | null => {
  const { author } = entry;
  if (author.kind !== "recovery" || author.credential_id !== body.credential_id) {
    return "recovery_join_author";
  }
  return atEntry?.registry.has(author.credential_id) === true ? null : "recovery_join_unenrolled";
};

const vetoRefusal = (
  entry: ChainEntry,
  body: KeyringBody,
  done: ReadonlyArray<ChainEntry>,
  before: ReadonlyMap<number, Authority>,
): ReceiverRefusal | null => {
  const join = done.find((e) => e.digest === body.join_digest);
  if (join?.body?.kind !== "recovery-join") return "veto_not_a_join";
  const signer = entry.author;
  if (signer.kind !== "device" || before.get(join.seq)?.members.has(signer.id) !== true) {
    return "veto_signer_not_member";
  }
  const vetoed = done.some(
    (e) => e.body?.kind === "recovery-join-vetoed" && e.body.join_digest === body.join_digest,
  );
  return vetoed ? "join_already_vetoed" : null;
};

const refusalOf = (
  entry: ChainEntry,
  done: ReadonlyArray<ChainEntry>,
  before: ReadonlyMap<number, Authority>,
): ReceiverRefusal | null => {
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
  if (body.kind === "recovery-join") return joinRefusal(entry, body, before.get(entry.seq));
  if (body.kind === "recovery-join-vetoed") return vetoRefusal(entry, body, done, before);
  return body.kind === "fork-resolution" ? forkRefusal(entry, body, done) : null;
};

const apply = (
  authority: Authority,
  body: KeyringBody,
  done: ReadonlyArray<ChainEntry>,
  before: ReadonlyMap<number, Authority>,
  cancelled: Set<string>,
  seq: number,
): Authority => {
  const { members, registry } = authority;
  if (body.kind === "genesis" && body.bootstrap !== undefined) {
    const { first_device: first, recovery_key: key } = body.bootstrap;
    return { members: new Map([[first.id, first]]), registry: new Map([[key.credential_id, key]]) };
  }
  if (body.kind === "approval" && body.principal !== undefined) {
    members.set(body.principal.id, body.principal);
  } else if (body.kind === "recovery-key" && body.credential_id !== undefined) {
    registry.set(body.credential_id, enrolledKey(body, body.credential_id));
  } else if (body.kind === "recovery-key-removed" && body.credential_id !== undefined) {
    registry.delete(body.credential_id);
  } else if (body.kind === "recovery-join" && body.principal !== undefined) {
    const used = body.credential_id === undefined ? undefined : registry.get(body.credential_id);
    return {
      members: new Map([[body.principal.id, body.principal]]),
      registry: used === undefined ? new Map() : new Map([[used.credential_id, used]]),
    };
  } else if (body.kind === "recovery-join-vetoed") {
    const join = done.find((e) => e.digest === body.join_digest);
    const prior = join === undefined ? undefined : before.get(join.seq);
    if (join === undefined || prior === undefined) return authority;
    const restored = new Map(prior.registry);
    if (join.body?.credential_id !== undefined) restored.delete(join.body.credential_id);
    for (const later of done) {
      if (later.seq > join.seq && later.seq < seq) cancelled.add(later.digest);
    }
    return { members: new Map(prior.members), registry: restored };
  } else if (body.kind === "rotation" && body.members !== undefined) {
    return { members: new Map(body.members.map((m) => [m.id, m])), registry };
  } else if (body.kind === "fork-resolution" && body.state !== undefined) {
    return authorityOf(body.state);
  }
  return authority;
};

const walk = (
  entries: ReadonlyArray<ChainEntry>,
): { readonly fold: AuthorityFold; readonly refused: ReceivedChain | null } => {
  let authority: Authority = { members: new Map(), registry: new Map() };
  const cancelled = new Set<string>();
  const before = new Map<number, Authority>();
  const done: ChainEntry[] = [];
  let refused: ReceivedChain | null = null;
  let lastSeq = 0;
  for (const entry of entries) {
    const replayed = entry.seq <= lastSeq;
    lastSeq = Math.max(lastSeq, entry.seq);
    if (!replayed) {
      before.set(entry.seq, {
        members: new Map(authority.members),
        registry: new Map(authority.registry),
      });
    }
    const reason = replayed ? "seq_not_increasing" : refusalOf(entry, done, before);
    if (reason !== null) {
      refused ??= { ok: false, seq: entry.seq, reason };
      continue;
    }
    const body = entry.kind === "keyring" ? (entry.body ?? null) : null;
    if (body !== null) authority = apply(authority, body, done, before, cancelled, entry.seq);
    done.push(entry);
  }
  return { fold: { ...authority, cancelled }, refused };
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
