// The engine's Verifier over the verified account chain (sync-design section 6 receiver order):
// the chain verifies the row (link, record signature, epoch, account), then the object opens under
// the epoch key this device holds (header binding, object signature, content hash, payload). Only
// records of this memory's space reach the engine; another space's records on the shared account
// sequence advance the cursor and apply nothing.

import type { ChainRejection } from "../crypto/chain.ts"
import type { OpenFailureReason } from "../crypto/open.ts"
import { openBatch } from "../crypto/open.ts"
import type { RejectionCounter } from "../crypto/rejection.ts"
import type { SyncObjectRecord } from "../crypto/vendor/sync-format/object-types.ts"
import { b64urlDecode } from "../crypto/vendor/sync-format/jcs.ts"
import type { BatchPayload, PulledEntry, RefusalCode, SnapshotRef, Verdict, Verifier } from "../engine/ports.ts"
import type { AccountChain } from "./account-chain.ts"

export const OPS_RECORD = 1

const CHAIN_REFUSALS: Partial<Record<ChainRejection, RefusalCode>> = {
  link_mismatch: "chain_link",
  bad_signature: "signature",
  not_member: "signature",
  epoch_mismatch: "epoch",
  account_mismatch: "account_binding",
  digest_mismatch: "content_hash",
}

const OPEN_REFUSALS: Partial<Record<OpenFailureReason, RefusalCode>> = {
  account_mismatch: "account_binding",
  epoch_mismatch: "epoch",
  author_mismatch: "signature",
  bad_signature: "signature",
  digest_mismatch: "content_hash",
  kind_mismatch: "object_binding",
}

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => left.length === right.length && left.every((byte, index) => byte === right[index])

export const hexOfB64url = (value: string): string => Buffer.from(b64urlDecode(value)).toString("hex")

export function spaceItems(records: ReadonlyArray<SyncObjectRecord>, spaceId: Uint8Array, type: number): BatchPayload {
  return {
    items: records
      .filter((record) => record.type === type && sameBytes(record.spaceId, spaceId))
      .map((record) => ({ key: record.itemKey, ops: new Uint8Array(record.body) })),
  }
}

export function createChainVerifier(input: {
  readonly chain: AccountChain
  readonly spaceId: Uint8Array
  readonly rejections: RejectionCounter
}): Verifier {
  const { chain, spaceId, rejections } = input
  const refuse = (code: RefusalCode): Verdict => ({ ok: false, code })
  return {
    async verifyEntry(entry: PulledEntry, bytes: Uint8Array): Promise<Verdict> {
      const position = await chain.reach(entry.seq)
      switch (position.kind) {
        case "refused":
          return refuse(CHAIN_REFUSALS[position.reason] ?? "malformed")
        case "pending":
        case "unknown":
          return refuse("sequence_gap")
        case "keyring":
          return entry.kind === "keyring" ? { ok: true, payload: { items: [] }, batchId: `keyring:${entry.seq}` } : refuse("object_binding")
        case "vetoed":
          return entry.kind === "batch" ? { ok: true, payload: { items: [] }, batchId: entry.batchId ?? `vetoed:${entry.seq}` } : refuse("object_binding")
        case "batch": {
          const batch = position.batch
          if (entry.kind !== "batch" || hexOfB64url(batch.digest) !== entry.digest) return refuse("content_hash")
          const key = await chain.epochKey(batch.epoch)
          if (key === null) return refuse("epoch")
          const opened = await openBatch(
            new Uint8Array(bytes),
            { account: chain.account, epoch: batch.epoch, authorId: batch.authorId, signingPublicKey: batch.signingPublicKey, digest: batch.digest, kind: "ops" },
            key,
            rejections,
          )
          if (!opened.ok) return refuse(OPEN_REFUSALS[opened.reason] ?? "malformed")
          return { ok: true, payload: spaceItems(opened.records, spaceId, OPS_RECORD), batchId: opened.batchId }
        }
      }
    },
    // Compaction snapshots are produced by todo 23; until a producer exists no snapshot is served,
    // and one that is served cannot be verified here, so it is refused rather than trusted.
    async verifySnapshot(_snapshot: SnapshotRef, _chunks: readonly Uint8Array[]): Promise<Verdict> {
      rejections.record("snapshot_unsupported")
      return refuse("malformed")
    },
  }
}
