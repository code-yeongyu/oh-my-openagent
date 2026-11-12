// Where `/memory-merge` keeps a source copy that cannot take its own path in the target (#10070).

import type { GitTreeBlobEntry } from "../git"

export const MERGED_ASIDE_ROOT = "reference/merged"

/**
 * The aside copy of `path`. A rerun whose usual aside path is already taken in the target (the user may
 * have edited that copy) gets a path keyed by the source head, so no committed target file is replaced.
 */
export function freeAsidePath(
  sourceId: string,
  sourceHead: string,
  path: string,
  targetBlobs: ReadonlyMap<string, GitTreeBlobEntry>,
  targetFolded: ReadonlySet<string>,
): string {
  const taken = (candidate: string) => targetBlobs.has(candidate) || targetFolded.has(candidate.toLowerCase())
  const usual = `${MERGED_ASIDE_ROOT}/${sourceId}/${path}`
  if (!taken(usual)) return usual
  const keyed = `${MERGED_ASIDE_ROOT}/${sourceId}@${sourceHead.slice(0, 12)}/${path}`
  if (!taken(keyed)) return keyed
  for (let suffix = 2; ; suffix += 1) {
    const numbered = `${MERGED_ASIDE_ROOT}/${sourceId}@${sourceHead.slice(0, 12)}-${suffix}/${path}`
    if (!taken(numbered)) return numbered
  }
}
