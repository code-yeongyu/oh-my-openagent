import type { AnchorRejection, ChainAnchor } from "./anchor.ts"
import { atVerifiedHead, type ChainState, emptyChain, verifyKeyringEntry } from "./chain.ts"
import type { KeyringEntry } from "./entry.ts"
import { isCancelledAdmission } from "./fold.ts"
import { openBatch } from "./open.ts"
import { receiverPass, wire } from "./receiver.ts"
import type { RejectionCounter } from "./rejection.ts"
import { b64urlDecode, sha256B64 } from "./vendor/sync-format/jcs.ts"
import { verifyObject } from "./vendor/sync-format/object.ts"
import type { SyncObjectRecord } from "./vendor/sync-format/object-types.ts"
import {
  importSnapshot as verifySnapshotImport,
  type SnapshotEnvelope,
  type SnapshotImportFailureReason,
} from "./vendor/sync-format/snapshot.ts"

/** The signed snapshot envelope of sync-design section 6, as the state route serves it. */
export type SnapshotRecord = SnapshotEnvelope

export type SnapshotRejection =
  | AnchorRejection
  | "account_mismatch"
  | "keyring_prefix_refused"
  | "bad_keyring_head"
  | "not_member"
  | "bad_signature"
  | "digest_mismatch"
  | "chunk_refused"

export type SnapshotOutcome =
  | { readonly ok: true; readonly state: ChainState; readonly records: ReadonlyArray<SyncObjectRecord> }
  | { readonly ok: false; readonly reason: SnapshotRejection }

const REJECTION: Readonly<Record<SnapshotImportFailureReason, SnapshotRejection>> = {
  snapshot_chain_refused: "keyring_prefix_refused",
  snapshot_keyring_head: "bad_keyring_head",
  snapshot_author_not_member: "not_member",
  snapshot_bad_record_sig: "bad_signature",
  snapshot_digest: "digest_mismatch",
  snapshot_account: "chunk_refused",
  snapshot_epoch: "chunk_refused",
  snapshot_author_mismatch: "chunk_refused",
  snapshot_kind: "chunk_refused",
  snapshot_chunk_coverage: "chunk_refused",
}

/**
 * Imports a compacted account from genesis (sync-design section 8.3). The keyring sub-chain up to
 * covers_seq verifies record by record through the client chain (signatures, keyring_link, the
 * merged receiver's refusals); the envelope and its chunks then pass the merged reference check
 * (vendored importSnapshot: keyring_head, the author's membership and signature over a preimage
 * that names the author, each chunk's binding, coverage and the digest). Only then is each chunk
 * opened, in header index order, and the records returned. The state continues the main chain from
 * the snapshot's link at covers_seq.
 */
export const importSnapshot = async (
  account: string,
  anchor: ChainAnchor,
  keyringEntries: ReadonlyArray<KeyringEntry>,
  snapshot: SnapshotRecord,
  chunks: ReadonlyArray<Uint8Array<ArrayBuffer>>,
  epochKeyFor: (epoch: number) => Uint8Array<ArrayBuffer> | null,
  rejections: RejectionCounter,
): Promise<SnapshotOutcome> => {
  const refuse = (reason: SnapshotRejection): SnapshotOutcome => {
    rejections.record(reason)
    return { ok: false, reason }
  }
  if (snapshot.account !== account) return refuse("account_mismatch")
  const covered = keyringEntries.filter((candidate) => candidate.seq <= snapshot.covers_seq)
  let state = emptyChain(account, anchor)
  const pass = await receiverPass([], covered)
  for (const entry of covered) {
    const step = await verifyKeyringEntry(state, entry, "keyring-only", pass)
    if (!step.ok) {
      const anchorFailure = step.reason === "untrusted_root" || step.reason === "anchor_mismatch"
      return refuse(anchorFailure ? step.reason : "keyring_prefix_refused")
    }
    state = step.state
  }
  if (!state.anchored) return refuse("unanchored")
  const authority = state.authority
  if (authority === null) return refuse("keyring_prefix_refused")
  if (isCancelledAdmission(authority, snapshot.author.id)) return refuse("not_member")
  const verified = await verifySnapshotImport({ snapshot, chunks, entries: wire(covered) })
  if (!verified.ok) return refuse(REJECTION[verified.reason])
  const signingPublicKey = snapshot.author.signing_public_key
  const ctx = {
    account: snapshot.account,
    epoch: verified.headers[0]?.epoch ?? 0,
    authorId: snapshot.author.id,
    authorSigningPublicKey: b64urlDecode(signingPublicKey),
  }
  const placed: Array<Uint8Array<ArrayBuffer> | undefined> = []
  for (const chunk of chunks) {
    const header = await verifyObject(chunk, ctx)
    const index = header.ok ? header.header.chunk?.index : undefined
    if (index === undefined) return refuse("chunk_refused")
    placed[index] = chunk
  }
  const epochKey = epochKeyFor(ctx.epoch)
  if (epochKey === null) return refuse("chunk_refused")
  const records: SyncObjectRecord[] = []
  for (const [index, chunk] of placed.entries()) {
    if (chunk === undefined) return refuse("chunk_refused")
    const opened = await openBatch(
      chunk,
      {
        account: snapshot.account,
        epoch: ctx.epoch,
        authorId: snapshot.author.id,
        signingPublicKey,
        digest: await sha256B64(chunk),
        kind: "snapshot",
        chunk: { index, count: placed.length },
      },
      epochKey,
      rejections,
    )
    if (!opened.ok) return { ok: false, reason: "chunk_refused" }
    records.push(...opened.records)
  }
  const continued = atVerifiedHead(state, { seq: snapshot.covers_seq, link: snapshot.link, keyring_link: snapshot.keyring_head })
  if (continued === null) return refuse("keyring_prefix_refused")
  return { ok: true, state: continued, records }
}
