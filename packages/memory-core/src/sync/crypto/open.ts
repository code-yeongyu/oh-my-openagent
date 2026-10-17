import type { RejectionCounter } from "./rejection.ts"
import { sha256B64 } from "./vendor/sync-format/jcs.ts"
import { decodeObject, verifyObject } from "./vendor/sync-format/object.ts"
import type { ObjectFailureReason, SyncObjectRecord } from "./vendor/sync-format/object-types.ts"
import { decodeB64 } from "./signatures.ts"

export type BatchBinding = {
  readonly account: string
  readonly epoch: number
  readonly authorId: string
  readonly signingPublicKey: string
  readonly digest: string
  readonly kind: "ops" | "snapshot"
  readonly chunk?: { readonly index: number; readonly count: number }
}

export type OpenFailureReason = ObjectFailureReason | "kind_mismatch" | "digest_mismatch" | "bad_key"

export type OpenOutcome =
  | { readonly ok: true; readonly batchId: string; readonly records: ReadonlyArray<SyncObjectRecord> }
  | { readonly ok: false; readonly reason: OpenFailureReason }

/**
 * Opens one object for a verified chain entry, in the receiver order of sync-design
 * section 6: the header binds the entry's account, epoch and author and the object
 * signature verifies under the author's folded key (check 5), the header kind and chunk
 * match the entry (check 5), the bytes hash to the entry digest (check 6), and only then
 * the STREAM payload opens under the epoch key. Every refusal counts one content-free
 * rejection and yields no records.
 */
export const openBatch = async (
  bytes: Uint8Array<ArrayBuffer>,
  binding: BatchBinding,
  epochKey: Uint8Array<ArrayBuffer>,
  rejections: RejectionCounter,
): Promise<OpenOutcome> => {
  const refuse = (reason: OpenFailureReason): OpenOutcome => {
    rejections.record(reason)
    return { ok: false, reason }
  }
  const signingKey = decodeB64(binding.signingPublicKey, 32)
  if (signingKey === null) return refuse("bad_key")
  const ctx = { account: binding.account, epoch: binding.epoch, authorId: binding.authorId, authorSigningPublicKey: signingKey }
  const verified = await verifyObject(bytes, ctx)
  if (!verified.ok) return refuse(verified.reason)
  const header = verified.header
  if (header.kind !== binding.kind) return refuse("kind_mismatch")
  const chunk = header.chunk
  const chunkMatches =
    binding.chunk === undefined
      ? chunk === undefined
      : chunk !== undefined && chunk.index === binding.chunk.index && chunk.count === binding.chunk.count
  if (!chunkMatches) return refuse("kind_mismatch")
  if ((await sha256B64(bytes)) !== binding.digest) return refuse("digest_mismatch")
  const opened = await decodeObject(bytes, { ...ctx, epochKey })
  if (!opened.ok) return refuse(opened.reason)
  return { ok: true, batchId: header.batch_id, records: opened.records }
}
