import { createHash } from "node:crypto"

// Diagnostics only. Never send to providers. Hash covers the stable prefix
// bytes (for example stableStringify output) for change-reason logging.
// Algorithm and length are pinned: changing them rewrites every logged hash,
// so any change must update prefix-hash.test.ts first.
export const PREFIX_HASH_ALGORITHM = "sha256" as const
export const PREFIX_HASH_HEX_LENGTH = 16 as const

export function prefixHash(canonicalBytes: string): string {
  return createHash(PREFIX_HASH_ALGORITHM)
    .update(canonicalBytes, "utf8")
    .digest("hex")
    .slice(0, PREFIX_HASH_HEX_LENGTH)
}
