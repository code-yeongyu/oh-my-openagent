/**
 * The one canonical order of every signed or hashed collection (docs/sync-design.md section 8):
 * a receiver refuses a collection that is out of order or holds a duplicate, never re-sorts it.
 * The comparators are exported so a sender sorts with exactly the order a receiver enforces.
 */

/** ASCII byte order of two protocol strings (identifiers are ASCII, so UTF-16 order agrees). */
export const asciiCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Rotation members and fork-state members: id ASCII ascending. */
export const compareMembers = (a: { readonly id: string }, b: { readonly id: string }): number =>
  asciiCompare(a.id, b.id);

/** Fork-state recovery keys: credential id ASCII ascending. */
export const compareRecoveryKeys = (
  a: { readonly credential_id: string },
  b: { readonly credential_id: string },
): number => asciiCompare(a.credential_id, b.credential_id);

/** Wrap sets: epoch ascending, then recipient identifier ASCII ascending. */
export const compareWrapEntries = (
  a: { readonly epoch: number; readonly id: string },
  b: { readonly epoch: number; readonly id: string },
): number => a.epoch - b.epoch || asciiCompare(a.id, b.id);

/**
 * True when every adjacent pair is strictly ascending under `compare`: an out-of-order pair or a
 * duplicate returns false instead of throwing, so a verifier folds it into its refusal path.
 */
export const assertCanonicalOrder = <T>(
  items: ReadonlyArray<T>,
  compare: (a: T, b: T) => number,
): boolean => {
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1];
    const current = items[i];
    if (prev === undefined || current === undefined) return false;
    if (compare(prev, current) >= 0) return false;
  }
  return true;
};
