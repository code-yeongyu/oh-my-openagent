/**
 * A fork-resolution's `fork_set` rule (docs/sync-design.md section 8.2): the set is ordered by
 * record reference (`seq` ascending, then `digest` ASCII bytes ascending), holds no duplicate, and
 * equals the evidence branches' tips element for element. Order is part of the signed bytes, so a
 * receiver refuses any other order instead of re-sorting it.
 */
import { asciiCompare, assertCanonicalOrder } from "./canonical.ts";
import type { RecordRef } from "./chain.ts";

export type { RecordRef } from "./chain.ts";

/** The canonical record-reference order: `seq` ascending, then `digest` ASCII ascending. */
export const compareRecordRef = (a: RecordRef, b: RecordRef): number =>
  a.seq - b.seq || asciiCompare(a.digest, b.digest);

const sameRef = (a: RecordRef, b: RecordRef): boolean =>
  a.seq === b.seq && a.digest === b.digest && a.keyring_link === b.keyring_link;

/**
 * True only when `forkSet` names at least two tips (fewer is no fork), is canonical, and equals
 * the evidence branch tips in that order.
 */
export const forkSetMatchesEvidence = (
  forkSet: ReadonlyArray<RecordRef>,
  branches: ReadonlyArray<{ readonly tip: RecordRef }>,
): boolean => {
  if (forkSet.length < 2) return false;
  if (!assertCanonicalOrder(forkSet, compareRecordRef)) return false;
  if (forkSet.length !== branches.length) return false;
  return forkSet.every((ref, i) => {
    const tip = branches[i]?.tip;
    return tip !== undefined && sameRef(ref, tip);
  });
};
