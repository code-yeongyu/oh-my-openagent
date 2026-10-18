/**
 * The receiver's entry point (docs/sync-design.md sections 7 and 8.2): the fold's refusals, then
 * the proof of every fork-resolution's evidence, so no caller can take a fold whose evidence was
 * never verified. Returns the fold, or the first refused record and why.
 */
import type { ChainEntry } from "./chain.ts";
import { foldAuthority, foldRefusal, type ReceivedChain } from "./fold.ts";
import { verifyForkEvidence } from "./fork-evidence.ts";

export const receiveKeyringChain = async (
  entries: ReadonlyArray<ChainEntry>,
): Promise<ReceivedChain> => {
  const folded = foldRefusal(entries);
  const refusedAt = folded.ok ? Number.POSITIVE_INFINITY : folded.seq;
  for (const entry of entries) {
    const evidence = entry.kind === "keyring" ? entry.body?.evidence : undefined;
    if (entry.seq >= refusedAt) break;
    if (entry.body?.kind !== "fork-resolution" || evidence === undefined) continue;
    const ancestry = entries.filter((e) => e.seq <= evidence.common.seq);
    if (!(await verifyForkEvidence(ancestry, evidence, foldAuthority))) {
      return { ok: false, seq: entry.seq, reason: "fork_evidence_invalid" };
    }
  }
  return folded;
};
