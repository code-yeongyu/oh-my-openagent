import type { Head, SyncAuthor, SyncEntry } from "./entry.ts"
import { type Authority, type FoldedRecord, isCancelledAdmission } from "./fold.ts"
import { nextLink } from "./links.ts"
import type { ParsedBody } from "./parse.ts"
import { authorSigningKey } from "./signatures.ts"

/** Main-chain mode checks seq, base_seq and link; keyring-only mode (snapshot import) checks the sub-chain alone. */
export type LinkMode = "main" | "keyring-only"

export const linksHold = async (head: Head | null, entry: SyncEntry, mode: LinkMode): Promise<boolean> => {
  const priorSeq = head === null ? 0 : head.seq
  if (mode === "main") {
    if (entry.base_seq !== priorSeq || entry.seq !== priorSeq + 1) return false
    if (entry.link !== (await nextLink(head === null ? "" : head.link, entry.digest))) return false
  } else if (entry.seq <= priorSeq || entry.base_seq !== entry.seq - 1) {
    return false
  }
  if (entry.kind === "batch") return entry.keyring_link === null
  return entry.keyring_link === (await nextLink(head === null ? "" : head.keyring_link, entry.digest))
}

export const signerKey = (
  body: ParsedBody,
  before: Authority | null,
  author: SyncAuthor,
  history: ReadonlyArray<FoldedRecord>,
): string | null => {
  if (body.kind === "genesis") {
    return author.kind === "device" && author.id === body.firstDevice.id ? body.firstDevice.signing_public_key : null
  }
  if (before === null) return null
  if (body.kind === "recovery-join") {
    return author.kind === "recovery" && author.credential_id === body.credentialId
      ? authorSigningKey(before, author)
      : null
  }
  if (author.kind !== "device") return null
  if (body.kind === "recovery-join-vetoed") {
    const join = history.find((record) => record.digest === body.joinDigest)
    return join?.before == null ? null : authorSigningKey(join.before, author)
  }
  if (isCancelledAdmission(before, author.id)) return null
  return authorSigningKey(before, author)
}

export const expectedEpoch = (body: ParsedBody, before: Authority | null): number | null => {
  if (body.kind === "genesis") return 1
  if (body.kind === "fork-resolution") return body.epoch
  if (before === null) return null
  return body.kind === "rotation" ? before.epoch + 1 : before.epoch
}

/** While a fork-resolution's forced rotation is pending only that rotation passes; otherwise no rotation may name one. */
export const forcedRotationRefusal = (
  forcedRotationAfter: number | null,
  body: ParsedBody | null,
): "forced_rotation_required" | "bad_fork_resolution" | null => {
  const fork = body?.kind === "rotation" ? body.forkResolution : null
  if (forcedRotationAfter !== null) return fork === forcedRotationAfter ? null : "forced_rotation_required"
  return fork === null ? null : "bad_fork_resolution"
}

/**
 * The author's signing key as it stood inside `epoch`: the newest folded authority of that epoch
 * that holds the author. A vetoed epoch's members are no longer in the current fold, so their
 * batches verify against the position they were written at, and an author never a member there
 * gets no key.
 */
export const keyWithinEpoch = (
  history: ReadonlyArray<FoldedRecord>,
  current: Authority | null,
  author: SyncAuthor,
  epoch: number,
): string | null => {
  const after = history.map((_, index) => history[index + 1]?.before ?? current)
  for (const authority of after.reverse()) {
    const key = authority !== null && authority.epoch === epoch ? authorSigningKey(authority, author) : null
    if (key !== null) return key
  }
  return null
}
