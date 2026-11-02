/**
 * The keyring fold's running state (docs/sync-design.md sections 7 and 8.2): the authority folded
 * so far, the indexes the receiver checks read, and how an accepted record body changes the
 * authority. fold.ts decides which records are accepted.
 */
import type {
  ChainEntry,
  ForkState,
  KeyringBody,
  SyncPrincipal,
  SyncRecoveryKey,
} from "./chain.ts";

export type Authority = {
  members: Map<string, SyncPrincipal>;
  registry: Map<string, SyncRecoveryKey>;
};

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

export const copyOf = (authority: Authority): Authority => ({
  members: new Map(authority.members),
  registry: new Map(authority.registry),
});

/**
 * The fold's running state over the entries accepted so far. Every lookup a check needs is an
 * index, so checking and folding one more entry does not re-read the entries before it.
 */
export type FoldState = {
  authority: Authority;
  readonly cancelled: Set<string>;
  /** Accepted entries; their seq strictly increases. */
  readonly done: ChainEntry[];
  /** Position in `done` of the first accepted entry with each digest. */
  readonly byDigest: Map<string, number>;
  /** Position in `done` of the accepted entry at each seq. */
  readonly bySeq: Map<number, number>;
  /** The authority just before each accepted recovery-join, by the join's seq. */
  readonly beforeJoin: Map<number, Authority>;
  /** Join digests an accepted veto names. */
  readonly vetoed: Set<string>;
  /** The highest seq seen, refused entries included. */
  lastSeq: number;
};

export const doneWithDigest = (
  state: FoldState,
  digest: string | undefined,
): ChainEntry | undefined => {
  const at = digest === undefined ? undefined : state.byDigest.get(digest);
  return at === undefined ? undefined : state.done[at];
};

/** The accepted entries through `seq`, which must be an accepted seq. */
export const doneThrough = (state: FoldState, seq: number): ReadonlyArray<ChainEntry> => {
  const at = state.bySeq.get(seq);
  return at === undefined ? [] : state.done.slice(0, at + 1);
};

export const apply = (state: FoldState, body: KeyringBody): Authority => {
  const { authority } = state;
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
    const at = body.join_digest === undefined ? undefined : state.byDigest.get(body.join_digest);
    const join = at === undefined ? undefined : state.done[at];
    const prior = join === undefined ? undefined : state.beforeJoin.get(join.seq);
    if (at === undefined || join === undefined || prior === undefined) return authority;
    const restored = new Map(prior.registry);
    if (join.body?.credential_id !== undefined) restored.delete(join.body.credential_id);
    // Every accepted entry after the join precedes this veto, so the veto cancels all of them.
    for (const later of state.done.slice(at + 1)) state.cancelled.add(later.digest);
    return { members: new Map(prior.members), registry: restored };
  } else if (body.kind === "rotation" && body.members !== undefined) {
    return { members: new Map(body.members.map((m) => [m.id, m])), registry };
  } else if (body.kind === "fork-resolution" && body.state !== undefined) {
    return authorityOf(body.state);
  }
  return authority;
};
