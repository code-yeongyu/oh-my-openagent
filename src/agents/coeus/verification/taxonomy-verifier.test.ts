import { describe, expect, it } from "bun:test";
import type { TaxonomyClient } from "../../../shared/taxonomy-client";
import type { BoundaryClaim } from "./boundary-claim-builder";
import { verifyClaims } from "./taxonomy-verifier";

function createMockClient(
  entries: Record<string, { category: string; tier: string; confidence: number } | null>
): TaxonomyClient {
  return {
    async query(category: string) {
      const entry = entries[category];
      if (!entry) return null;
      return {
        category: entry.category,
        solutions: [
          {
            name: "test-solution",
            description: "test",
            sources: [
              {
                ref: "test-ref",
                claim: "test-claim",
                tier: entry.tier as "tier-1-ground-truth",
                confidence: entry.confidence,
                type: "docs" as const,
              },
            ],
          },
        ],
        related: [],
      };
    },
    async queryRelated() {
      return [];
    },
    async queryMultiple(categories: string[]) {
      const results = new Map();
      for (const c of categories) {
        results.set(c, null);
      }
      return results;
    },
  };
}

describe("verifyClaims", () => {
  it("returns verified status when taxonomy entry found", async () => {
    //#given a claim and a client that returns an entry
    const claims: BoundaryClaim[] = [
      { boundary: "auth: JWT signing", domain: "auth", query_term: "auth" },
    ];
    const client = createMockClient({
      auth: {
        category: "auth",
        tier: "tier-2-validated-reference",
        confidence: 0.9,
      },
    });

    //#when verifying claims
    const results = await verifyClaims(claims, client);

    //#then status is verified with confidence and tier
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("verified");
    expect(results[0].confidence).toBe(0.9);
    expect(results[0].tier).toBe("tier-2-validated-reference");
    expect(results[0].matched_entry).toBe("auth");
  });

  it("returns novel status when no taxonomy entry found", async () => {
    //#given a claim and a client that returns null
    const claims: BoundaryClaim[] = [
      {
        boundary: "quantum: entanglement routing",
        domain: "quantum",
        query_term: "quantum",
      },
    ];
    const client = createMockClient({ quantum: null });

    //#when verifying claims
    const results = await verifyClaims(claims, client);

    //#then status is novel
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("novel");
    expect(results[0].matched_entry).toBeUndefined();
    expect(results[0].confidence).toBeUndefined();
    expect(results[0].tier).toBeUndefined();
  });

  it("never throws even with failing client", async () => {
    //#given a client that rejects
    const failingClient: TaxonomyClient = {
      async query() {
        throw new Error("network failure");
      },
      async queryRelated() {
        return [];
      },
      async queryMultiple() {
        return new Map();
      },
    };
    const claims: BoundaryClaim[] = [
      { boundary: "db: connection pool", domain: "db", query_term: "db" },
    ];

    //#when verifying claims
    const results = await verifyClaims(claims, failingClient);

    //#then returns unverified instead of throwing
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("unverified");
  });

  it("handles multiple claims", async () => {
    //#given multiple claims with mixed results
    const claims: BoundaryClaim[] = [
      { boundary: "auth: JWT", domain: "auth", query_term: "auth" },
      { boundary: "cache: redis", domain: "cache", query_term: "cache" },
    ];
    const client = createMockClient({
      auth: {
        category: "auth",
        tier: "tier-1-ground-truth",
        confidence: 0.95,
      },
      cache: null,
    });

    //#when verifying claims
    const results = await verifyClaims(claims, client);

    //#then first is verified, second is novel
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("verified");
    expect(results[1].status).toBe("novel");
  });
});
