/**
 * A fork-resolution's merged authority (docs/sync-design.md section 8.2), recomputed from the
 * evidence with removal precedence: a member or recovery key held at the common ancestor that any
 * branch removed is gone; one added on a branch survives only if every branch holds it. The
 * receiver compares this with the stated `state`, never echoes it.
 */

import { compareMembers, compareRecoveryKeys } from "./canonical.ts";
import type {
  AuthorityFold,
  ChainEntry,
  ForkEvidence,
  ForkState,
  SyncPrincipal,
  SyncRecoveryKey,
} from "./chain.ts";

const mergeWithRemovalPrecedence = <V>(
  base: ReadonlyMap<string, V>,
  ends: ReadonlyArray<ReadonlyMap<string, V>>,
): Map<string, V> => {
  const removed = new Set([...base.keys()].filter((key) => ends.some((end) => !end.has(key))));
  const merged = new Map([...base].filter(([key]) => !removed.has(key)));
  const first = ends[0];
  if (first === undefined) return merged;
  for (const [key, value] of first) {
    if (!merged.has(key) && !removed.has(key) && ends.every((end) => end.has(key))) {
      merged.set(key, value);
    }
  }
  return merged;
};

/**
 * The state a resolution of `evidence` must carry, given the chain through the common ancestor.
 * `fold` is the authority fold itself, passed in so a nested resolution folds the same way.
 */
export const recomputeForkStateWith = (
  fold: (entries: ReadonlyArray<ChainEntry>) => AuthorityFold,
  ancestry: ReadonlyArray<ChainEntry>,
  evidence: ForkEvidence,
): ForkState => {
  const common = fold(ancestry);
  const ends = evidence.branches.map((branch) => fold([...ancestry, ...branch.records]));
  const members: SyncPrincipal[] = [
    ...mergeWithRemovalPrecedence(
      common.members,
      ends.map((end) => end.members),
    ).values(),
  ].sort(compareMembers);
  const recoveryKeys: SyncRecoveryKey[] = [
    ...mergeWithRemovalPrecedence(
      common.registry,
      ends.map((end) => end.registry),
    ).values(),
  ].sort(compareRecoveryKeys);
  const epoch = Math.max(
    0,
    ...evidence.branches.flatMap((branch) => branch.records.map((record) => record.epoch)),
  );
  return { members, recovery_keys: recoveryKeys, epoch };
};
