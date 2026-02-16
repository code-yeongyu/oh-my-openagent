import { describe, it, expect } from "bun:test";
import {
  AuthorityTier,
  ProvenanceSchema,
  SolutionSchema,
  TaxonomyEntrySchema,
} from "./schema";

describe("AuthorityTier", () => {
  //#given valid tier values
  //#when parsing tier enum
  //#then should accept all 4 tiers
  it("should accept all 4 authority tiers", () => {
    const validTiers = [
      "tier-1-ground-truth",
      "tier-2-validated-reference",
      "tier-3-battle-tested",
      "tier-4-community",
    ];

    validTiers.forEach((tier) => {
      const result = AuthorityTier.safeParse(tier);
      expect(result.success).toBe(true);
    });
  });

  //#given invalid tier value
  //#when parsing tier enum
  //#then should reject
  it("should reject invalid tier values", () => {
    const result = AuthorityTier.safeParse("tier-5-invalid");
    expect(result.success).toBe(false);
  });
});

describe("ProvenanceSchema", () => {
  //#given valid provenance data
  //#when parsing provenance
  //#then should validate successfully
  it("should validate minimal provenance", () => {
    const data = {
      ref: "CLRS, 4th Ed, Chapter 2.3",
      claim: "O(n) auxiliary space",
      tier: "tier-1-ground-truth",
      confidence: 0.95,
      type: "textbook",
    };

    const result = ProvenanceSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  //#given provenance with optional fields
  //#when parsing provenance
  //#then should include optional fields
  it("should validate provenance with optional fields", () => {
    const data = {
      ref: "RFC 7231",
      claim: "HTTP/1.1 semantics",
      tier: "tier-2-validated-reference",
      confidence: 0.9,
      type: "spec",
      isbn: "978-0-13-468599-1",
      url: "https://tools.ietf.org/html/rfc7231",
      verified_by: "alice@example.com",
    };

    const result = ProvenanceSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  //#given provenance with empty ref
  //#when parsing provenance
  //#then should reject
  it("should reject empty ref", () => {
    const data = {
      ref: "",
      claim: "O(n) auxiliary space",
      tier: "tier-1-ground-truth",
      confidence: 0.95,
      type: "textbook",
    };

    const result = ProvenanceSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  //#given provenance with confidence out of range
  //#when parsing provenance
  //#then should reject
  it("should reject confidence outside [0, 1]", () => {
    const data = {
      ref: "CLRS",
      claim: "O(n) space",
      tier: "tier-1-ground-truth",
      confidence: 1.5,
      type: "textbook",
    };

    const result = ProvenanceSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  //#given provenance with invalid URL
  //#when parsing provenance
  //#then should reject
  it("should reject invalid URL", () => {
    const data = {
      ref: "Blog post",
      claim: "Some claim",
      tier: "tier-4-community",
      confidence: 0.5,
      type: "blog",
      url: "not-a-url",
    };

    const result = ProvenanceSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("SolutionSchema", () => {
  //#given valid solution with sources
  //#when parsing solution
  //#then should validate successfully
  it("should validate solution with sources", () => {
    const data = {
      name: "MergeSort",
      description: "Divide-and-conquer sorting algorithm",
      sources: [
        {
          ref: "CLRS, 4th Ed, Chapter 2.3",
          claim: "O(n log n) time complexity",
          tier: "tier-1-ground-truth",
          confidence: 0.99,
          type: "textbook",
        },
      ],
    };

    const result = SolutionSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  //#given solution with spec_compliant flag
  //#when parsing solution
  //#then should include optional fields
  it("should validate solution with optional fields", () => {
    const data = {
      name: "QuickSort",
      description: "In-place sorting algorithm",
      spec_compliant: true,
      sources: [
        {
          ref: "Hoare, 1962",
          claim: "Average O(n log n)",
          tier: "tier-2-validated-reference",
          confidence: 0.95,
          type: "paper",
        },
      ],
      constraints: {
        memory: "O(log n) stack space",
        stability: false,
      },
    };

    const result = SolutionSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  //#given solution with empty sources
  //#when parsing solution
  //#then should reject
  it("should reject solution with empty sources", () => {
    const data = {
      name: "BubbleSort",
      description: "Simple sorting",
      sources: [],
    };

    const result = SolutionSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  //#given solution with empty name
  //#when parsing solution
  //#then should reject
  it("should reject solution with empty name", () => {
    const data = {
      name: "",
      description: "Some description",
      sources: [
        {
          ref: "Ref",
          claim: "Claim",
          tier: "tier-1-ground-truth",
          confidence: 0.9,
          type: "textbook",
        },
      ],
    };

    const result = SolutionSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("TaxonomyEntrySchema", () => {
  //#given valid taxonomy entry
  //#when parsing entry
  //#then should validate successfully
  it("should validate minimal taxonomy entry", () => {
    const data = {
      category: "MergeSort",
      solutions: [
        {
          name: "Classic MergeSort",
          description: "Standard divide-and-conquer",
          sources: [
            {
              ref: "CLRS",
              claim: "O(n log n) time",
              tier: "tier-1-ground-truth",
              confidence: 0.99,
              type: "textbook",
            },
          ],
        },
      ],
      related: ["QuickSort", "HeapSort"],
    };

    const result = TaxonomyEntrySchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  //#given taxonomy entry with all optional fields
  //#when parsing entry
  //#then should include pitfalls, complexity, implementation_notes
  it("should validate taxonomy entry with all fields", () => {
    const data = {
      category: "RateLimiting",
      solutions: [
        {
          name: "Token Bucket",
          description: "Refill tokens at fixed rate",
          sources: [
            {
              ref: "RFC 6585",
              claim: "HTTP 429 Too Many Requests",
              tier: "tier-2-validated-reference",
              confidence: 0.95,
              type: "spec",
            },
          ],
        },
      ],
      pitfalls: [
        {
          trigger: "Burst traffic exceeds bucket capacity",
          source: {
            ref: "Production incident",
            claim: "Dropped requests",
            tier: "tier-3-battle-tested",
            confidence: 0.9,
            type: "oss",
          },
        },
      ],
      complexity: "O(1) per request",
      related: ["LeakyBucket", "SlidingWindow"],
      implementation_notes: [
        "Use atomic operations for thread safety",
        "Consider clock skew in distributed systems",
      ],
    };

    const result = TaxonomyEntrySchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  //#given taxonomy entry with empty category
  //#when parsing entry
  //#then should reject
  it("should reject empty category", () => {
    const data = {
      category: "",
      solutions: [
        {
          name: "Solution",
          description: "Desc",
          sources: [
            {
              ref: "Ref",
              claim: "Claim",
              tier: "tier-1-ground-truth",
              confidence: 0.9,
              type: "textbook",
            },
          ],
        },
      ],
      related: [],
    };

    const result = TaxonomyEntrySchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  //#given taxonomy entry with empty solutions
  //#when parsing entry
  //#then should reject
  it("should reject empty solutions", () => {
    const data = {
      category: "Algorithm",
      solutions: [],
      related: [],
    };

    const result = TaxonomyEntrySchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  //#given taxonomy entry with invalid pitfall source
  //#when parsing entry
  //#then should reject
  it("should reject invalid pitfall source", () => {
    const data = {
      category: "Algorithm",
      solutions: [
        {
          name: "Solution",
          description: "Desc",
          sources: [
            {
              ref: "Ref",
              claim: "Claim",
              tier: "tier-1-ground-truth",
              confidence: 0.9,
              type: "textbook",
            },
          ],
        },
      ],
      pitfalls: [
        {
          trigger: "Some trigger",
          source: {
            ref: "",
            claim: "Claim",
            tier: "tier-1-ground-truth",
            confidence: 0.9,
            type: "textbook",
          },
        },
      ],
      related: [],
    };

    const result = TaxonomyEntrySchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
