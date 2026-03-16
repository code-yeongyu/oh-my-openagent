import type { TaxonomyClient } from "../../../shared/taxonomy-client";
import type { BoundaryVerification } from "../schemas/verification-record-schema";
import type { BoundaryClaim } from "./boundary-claim-builder";

export async function verifyClaims(
  claims: BoundaryClaim[],
  client: TaxonomyClient
): Promise<BoundaryVerification[]> {
  const results: BoundaryVerification[] = [];

  for (const claim of claims) {
    try {
      const entry = await client.query(claim.query_term);
      if (entry) {
        const topSource = entry.solutions[0]?.sources[0];
        results.push({
          boundary: claim.boundary,
          query: claim.query_term,
          matched_entry: entry.category,
          confidence: topSource?.confidence,
          tier: topSource?.tier,
          status: "verified",
        });
      } else {
        results.push({
          boundary: claim.boundary,
          query: claim.query_term,
          status: "novel",
        });
      }
    } catch {
      results.push({
        boundary: claim.boundary,
        query: claim.query_term,
        status: "unverified",
      });
    }
  }

  return results;
}
