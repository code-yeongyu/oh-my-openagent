// Set-element and register-entry tags: unique per op on the writing peer (peer @ op count,
// plus a slot when one batch reserves several tags before writing), salted with the value.

import type { LoroDoc } from "../../crdt/loro-runtime"

export function newTag(doc: LoroDoc, salt: string, slot = 0): string {
  const at = slot === 0 ? `${doc.opCount()}` : `${doc.opCount()}+${slot}`
  return `${doc.peerIdStr}@${at}#${fnv1a(salt, 2166136261)}${fnv1a(salt, 424242)}`
}

function fnv1a(text: string, basis: number): string {
  let hash = basis
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
