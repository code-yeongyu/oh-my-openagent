/**
 * A fork-resolution's evidence (docs/sync-design.md section 8.2), checked record by record. The
 * shape check is part of the fold: each branch runs contiguously from the common ancestor's seq
 * + 1, every record has seq = base_seq + 1, and the last record is the branch tip. The proof
 * check is async and runs in `receiveKeyringChain`, so no receiver skips it: every record's link
 * and keyring link chain from the common ancestor, a keyring record's digest is the SHA-256 of
 * its canonical body, and its record_sig verifies under the authority folded at its branch
 * position.
 */
import {
  type AuthorityFold,
  type ChainEntry,
  type ForkEvidence,
  linkDigestPair,
  verifyEntrySignature,
} from "./chain.ts";
import { jcsBytes, sha256B64 } from "./jcs.ts";

export type BranchRefusal = "noncanonical_order" | "fork_set_mismatch";

export const branchRefusal = (evidence: ForkEvidence): BranchRefusal | null => {
  for (const { records, tip } of evidence.branches) {
    const last = records.at(-1);
    if (last === undefined) return "fork_set_mismatch";
    for (const [i, record] of records.entries()) {
      const expected = evidence.common.seq + 1 + i;
      if (record.seq !== expected || record.seq !== record.base_seq + 1)
        return "noncanonical_order";
    }
    // A batch carries no keyring link: the tip names the branch's last keyring link, or the
    // common ancestor's when the branch holds no keyring record.
    const lastKeyring = records.filter((r) => r.kind === "keyring").at(-1);
    const tipLink = lastKeyring?.keyring_link ?? evidence.common.keyring_link;
    if (last.seq !== tip.seq || last.digest !== tip.digest || tipLink !== tip.keyring_link) {
      return "fork_set_mismatch";
    }
  }
  return null;
};

const recordProves = async (
  record: ChainEntry,
  prior: { readonly link: string; readonly keyringLink: string },
): Promise<boolean> => {
  if (record.link !== (await sha256B64(linkDigestPair(prior.link, record.digest)))) return false;
  if (record.kind === "batch") return record.keyring_link === null && record.body == null;
  if (record.body === undefined || record.body === null) return false;
  if (record.digest !== (await sha256B64(jcsBytes(record.body)))) return false;
  const keyringLink = await sha256B64(linkDigestPair(prior.keyringLink, record.digest));
  return record.keyring_link === keyringLink;
};

/**
 * True when every evidence record chains from the common ancestor and is signed by an author
 * the fold authorizes at its branch position. `ancestry` is the chain through the common ancestor
 * and `foldAt` the authority fold, passed in so this module does not import the fold.
 */
export const verifyForkEvidence = async (
  ancestry: ReadonlyArray<ChainEntry>,
  evidence: ForkEvidence,
  foldAt: (entries: ReadonlyArray<ChainEntry>) => AuthorityFold,
): Promise<boolean> => {
  const common = ancestry.find(
    (e) => e.seq === evidence.common.seq && e.digest === evidence.common.digest,
  );
  if (common === undefined) return false;
  for (const { records } of evidence.branches) {
    let prior = { link: common.link, keyringLink: evidence.common.keyring_link };
    for (const [i, record] of records.entries()) {
      if (!(await recordProves(record, prior))) return false;
      const fold = foldAt([...ancestry, ...records.slice(0, i)]);
      if (!(await verifyEntrySignature(fold, record))) return false;
      prior = {
        link: record.link,
        keyringLink: record.kind === "keyring" ? (record.keyring_link ?? "") : prior.keyringLink,
      };
    }
  }
  return true;
};
