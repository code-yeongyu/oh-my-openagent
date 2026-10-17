import type { KeyringEntry, WrapEntry } from "./entry.ts"
import type { Authority, FoldedRecord } from "./fold.ts"
import { wrapSetDigest } from "./links.ts"
import type { ParsedBody } from "./parse.ts"
import { deviceIdOf, taggedHash, verifyTagged } from "./signatures.ts"

export type RuleRejection =
  | "bad_genesis"
  | "bad_custody_root"
  | "bad_countersign"
  | "bad_wrap_set"
  | "wraps_digest_mismatch"
  | "credential_reused"
  | "unknown_credential"
  | "already_member"
  | "bad_device_id"
  | "bad_commitment"
  | "member_not_in_fold"
  | "bad_keyring_head"
  | "unknown_join"
  | "veto_signer_not_member"
  | "unexpected_wraps"

const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index])

const checkWrapSet = async (
  wraps: ReadonlyArray<WrapEntry>,
  wrapsDigest: string,
  epoch: number,
  recipients: ReadonlyArray<string>,
): Promise<RuleRejection | null> => {
  const set = await wrapSetDigest(wraps)
  if (!set.ok) return "bad_wrap_set"
  if (set.digest !== wrapsDigest) return "wraps_digest_mismatch"
  const got = wraps.map((wrap) => `${wrap.epoch}:${wrap.id}`).sort()
  const want = recipients.map((id) => `${epoch}:${id}`).sort()
  return same(got, want) ? null : "bad_wrap_set"
}

const countersignOk = (
  account: string,
  custodyRoot: string,
  predecessor: string,
  wrapsDigest: string,
  signingPublicKey: string,
  countersign: string,
): Promise<boolean> =>
  verifyTagged(
    "omo-sync/v1/recovery-countersign",
    {
      t: "omo-sync/v1/recovery-countersign",
      account,
      custody_root: custodyRoot,
      predecessor,
      wraps_digest: wrapsDigest,
    },
    signingPublicKey,
    countersign,
  )

const registryIds = (authority: Authority): ReadonlyArray<string> =>
  [...authority.registry.keys()].map((id) => `recovery:${id}`)

/**
 * The per-kind receiver checks of the sync-design section 8.2 verifier table, run after the
 * chain link, the record signature and the epoch have passed. `before` is the authority
 * folded from every keyring record earlier in the chain; `predecessor` is the keyring_link
 * of the immediately preceding keyring record ("" at genesis).
 */
export const checkRecordRules = async (
  entry: KeyringEntry,
  body: ParsedBody,
  before: Authority | null,
  history: ReadonlyArray<FoldedRecord>,
  predecessor: string,
): Promise<RuleRejection | null> => {
  const account = entry.account
  if (body.kind === "genesis") {
    if (before !== null || entry.seq !== 1) return "bad_genesis"
    if ((await deviceIdOf(body.firstDevice.signing_public_key)) !== body.firstDevice.id) {
      return "bad_device_id"
    }
    if ((await taggedHash("omo-sync/v1/custody-root", body.bootstrap)) !== body.custodyRoot) {
      return "bad_custody_root"
    }
    const key = body.recoveryKey
    if (!(await countersignOk(account, body.custodyRoot, "", body.wrapsDigest, key.signing_public_key, body.countersign))) {
      return "bad_countersign"
    }
    return checkWrapSet(entry.wraps, body.wrapsDigest, 1, [
      `device:${body.firstDevice.id}`,
      `recovery:${key.credential_id}`,
    ])
  }
  if (before === null) return "bad_genesis"
  switch (body.kind) {
    case "recovery-key": {
      const key = body.key
      if (before.enrolledEver.has(key.credential_id)) return "credential_reused"
      const ok = await countersignOk(
        account,
        before.custodyRoot,
        predecessor,
        body.wrapsDigest,
        key.signing_public_key,
        body.countersign,
      )
      if (!ok) return "bad_countersign"
      return checkWrapSet(entry.wraps, body.wrapsDigest, before.epoch, [`recovery:${key.credential_id}`])
    }
    case "recovery-key-removed":
      if (!before.registry.has(body.credentialId)) return "unknown_credential"
      return entry.wraps.length === 0 ? null : "unexpected_wraps"
    case "approval": {
      const principal = body.principal
      if (before.members.has(principal.id)) return "already_member"
      if ((await deviceIdOf(principal.signing_public_key)) !== principal.id) return "bad_device_id"
      const commitment = await taggedHash("omo-sync/v1/approval-commitment", {
        account,
        sealing_public_key: principal.sealing_public_key,
        signing_public_key: principal.signing_public_key,
        nonce: body.joiningNonce,
      })
      if (commitment !== body.commitment) return "bad_commitment"
      return checkWrapSet(entry.wraps, body.wrapsDigest, before.epoch, [`device:${principal.id}`])
    }
    case "rotation": {
      if (body.members.some((member) => before.members.get(member.id)?.signing_public_key !== member.signing_public_key)) {
        return "member_not_in_fold"
      }
      const recipients = [...body.members.map((member) => `device:${member.id}`), ...registryIds(before)]
      return checkWrapSet(entry.wraps, body.wrapsDigest, before.epoch + 1, recipients)
    }
    case "recovery-join": {
      if (!before.registry.has(body.credentialId)) return "unknown_credential"
      if (body.keyringHead !== predecessor) return "bad_keyring_head"
      if ((await deviceIdOf(body.principal.signing_public_key)) !== body.principal.id) {
        return "bad_device_id"
      }
      return entry.wraps.length === 0 ? null : "unexpected_wraps"
    }
    case "recovery-join-vetoed": {
      const join = history.find((record) => record.digest === body.joinDigest)
      if (join === undefined || join.body.kind !== "recovery-join" || join.before === null) {
        return "unknown_join"
      }
      if (entry.author.kind !== "device" || !join.before.members.has(entry.author.id)) {
        return "veto_signer_not_member"
      }
      return entry.wraps.length === 0 ? null : "unexpected_wraps"
    }
    case "fork-resolution":
      return entry.wraps.length === 0 ? null : "unexpected_wraps"
  }
}
