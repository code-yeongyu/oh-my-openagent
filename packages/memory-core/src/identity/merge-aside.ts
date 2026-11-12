// Where `/memory-merge` keeps a source copy that cannot take its own path in the target (#10070).

import type { GitTreeBlobEntry } from "../git"

export const MERGED_ASIDE_ROOT = "reference/merged"

/**
 * The aside copy of `path`. A rerun whose usual aside path is already taken in the target (the user may
 * have edited that copy) gets a path keyed by the source head, so no committed target file is replaced.
 * `undefined` when one of those paths already holds exactly this content: a store left unmerged (an entry
 * could not be placed) is planned again from scratch, and its earlier aside copy must not be written twice.
 */
export function freeAsidePath(
  sourceId: string,
  sourceHead: string,
  entry: GitTreeBlobEntry,
  targetBlobs: ReadonlyMap<string, GitTreeBlobEntry>,
  targetFolded: ReadonlySet<string>,
): string | undefined {
  for (const candidate of asideCandidates(sourceId, sourceHead, entry.path)) {
    const existing = targetBlobs.get(candidate)
    if (existing?.oid === entry.oid) return undefined
    if (existing === undefined && !targetFolded.has(candidate.toLowerCase())) return candidate
  }
  return undefined
}

function* asideCandidates(sourceId: string, sourceHead: string, path: string): Generator<string> {
  yield `${MERGED_ASIDE_ROOT}/${sourceId}/${path}`
  const keyed = `${MERGED_ASIDE_ROOT}/${sourceId}@${sourceHead.slice(0, 12)}`
  yield `${keyed}/${path}`
  for (let suffix = 2; ; suffix += 1) yield `${keyed}-${suffix}/${path}`
}
