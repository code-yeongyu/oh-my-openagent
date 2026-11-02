import type { WrapEntry } from "./entry.ts"
import { concatBytes, type JsonValue, jcsBytes, sha256B64 } from "./vendor/sync-format/jcs.ts"
import { decodeB64 } from "./signatures.ts"

/** A chain link: SHA-256 over the raw 32-byte prior link and digest; genesis hashes its digest alone. */
export const nextLink = async (prior: string, digest: string): Promise<string | null> => {
  const digestBytes = decodeB64(digest, 32)
  if (digestBytes === null) return null
  if (prior.length === 0) return sha256B64(digestBytes)
  const priorBytes = decodeB64(prior, 32)
  if (priorBytes === null) return null
  return sha256B64(concatBytes([priorBytes, digestBytes]))
}

export type WrapSetCheck =
  | { readonly ok: true; readonly digest: string }
  | { readonly ok: false; readonly reason: "duplicate_wrap" }

/**
 * The wraps digest of sync-design section 7: SHA-256 of one RFC 8785 array of
 * {epoch, id, wrap} hashed in the order served - the record's signed wraps_digest binds that
 * order. Duplicate (epoch, id) tuples are refused. The order itself is not enforced: the
 * golden sync-v1 vectors (veto_rotation_wraps) pin a non-ASCII order, contradicting the
 * spec's ordering sentence; reported upstream rather than diverging from the oracle.
 */
export const wrapSetDigest = async (wraps: ReadonlyArray<WrapEntry>): Promise<WrapSetCheck> => {
  const seen = new Set(wraps.map((wrap) => `${wrap.epoch}:${wrap.id}`))
  if (seen.size !== wraps.length) return { ok: false, reason: "duplicate_wrap" }
  const rows: ReadonlyArray<JsonValue> = wraps.map((wrap) => ({
    epoch: wrap.epoch,
    id: wrap.id,
    wrap: wrap.wrap,
  }))
  return { ok: true, digest: await sha256B64(jcsBytes(rows)) }
}
