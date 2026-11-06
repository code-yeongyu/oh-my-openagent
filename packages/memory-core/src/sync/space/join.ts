// Joining two spaces (sync-design §3): any device that sees two manifests sharing a
// binding key joins them toward the LOWER space id. The absorbing space's manifest takes
// every binding key of the absorbed one (add-wins), and the absorbed manifest gets its
// `absorbed_into` tombstone in the same step, so a device that later sees the marker never
// adopts again. The tombstone makes the join idempotent; a second join of the pair changes
// nothing.

import type { LoroDoc } from "../../crdt/loro-runtime"

import { manifestAbsorbedInto, manifestAddBinding, manifestBindings, manifestMarkAbsorbed } from "./manifest"

export interface JoinDirection {
  readonly target: string
  readonly absorbed: string
}

export interface JoinResult {
  readonly targetId: string
  readonly absorbedId: string
  readonly changed: boolean
}

export function joinDirection(aId: string, bId: string): JoinDirection | null {
  if (aId === bId) return null
  return aId < bId ? { target: aId, absorbed: bId } : { target: bId, absorbed: aId }
}

/** Caller must establish a shared binding key before joining distinct spaces. */
export function joinSpaces(aDoc: LoroDoc, aId: string, bDoc: LoroDoc, bId: string): JoinResult {
  const dir = joinDirection(aId, bId)
  if (dir === null) return { targetId: aId, absorbedId: aId, changed: false }
  const absorbedDoc = dir.absorbed === aId ? aDoc : bDoc
  const targetDoc = dir.absorbed === aId ? bDoc : aDoc
  const existing = manifestAbsorbedInto(absorbedDoc)
  if (existing !== null) return { targetId: existing, absorbedId: dir.absorbed, changed: false }
  for (const key of manifestBindings(absorbedDoc)) manifestAddBinding(targetDoc, key)
  manifestMarkAbsorbed(absorbedDoc, dir.target)
  return { targetId: dir.target, absorbedId: dir.absorbed, changed: true }
}
