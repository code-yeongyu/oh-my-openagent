import { describe, it, expect } from "bun:test";
import {
  validateProvenance,
  rankSources,
} from "./provenance-validator";
import type { TaxonomyEntry, Provenance } from "./schema";

describe("rankSources", () => {
  //#given sources with different tiers
  //#when rankSources is called
  //#then sources are sorted by tier rank (tier-1 first) then by confidence descending
  it("sorts sources by tier rank ascending (tier-1 first)", () => {
    const sources: Provenance[] = [
      {
        ref: "ref1",
        claim: "claim1",
        tier: "tier-4-community",
        confidence: 0.9,
        type: "blog",
      },
      {
        ref: "ref2",
        claim: "claim2",
        tier: "tier-1-ground-truth",
        confidence: 0.8,
        type: "spec",
      },
      {
        ref: "ref3",
        claim: "claim3",
        tier: "tier-2-validated-reference",
        confidence: 0.85,
        type: "paper",
      },
    ];

    const ranked = rankSources(sources);

    expect(ranked[0].tier).toBe("tier-1-ground-truth");
    expect(ranked[1].tier).toBe("tier-2-validated-reference");
    expect(ranked[2].tier).toBe("tier-4-community");
  });

  //#given sources with same tier
  //#when rankSources is called
  //#then sources are sorted by confidence descending
  it("sorts same-tier sources by confidence descending", () => {
    const sources: Provenance[] = [
      {
        ref: "ref1",
        claim: "claim1",
        tier: "tier-2-validated-reference",
        confidence: 0.7,
        type: "docs",
      },
      {
        ref: "ref2",
        claim: "claim2",
        tier: "tier-2-validated-reference",
        confidence: 0.95,
        type: "textbook",
      },
      {
        ref: "ref3",
        claim: "claim3",
        tier: "tier-2-validated-reference",
        confidence: 0.85,
        type: "oss",
      },
    ];

    const ranked = rankSources(sources);

    expect(ranked[0].confidence).toBe(0.95);
    expect(ranked[1].confidence).toBe(0.85);
    expect(ranked[2].confidence).toBe(0.7);
  });

  //#given sources array
  //#when rankSources is called
  //#then input array is not mutated
  it("does not mutate input array", () => {
    const sources: Provenance[] = [
      {
        ref: "ref1",
        claim: "claim1",
        tier: "tier-4-community",
        confidence: 0.9,
        type: "blog",
      },
      {
        ref: "ref2",
        claim: "claim2",
        tier: "tier-1-ground-truth",
        confidence: 0.8,
        type: "spec",
      },
    ];

    const original = [...sources];
    rankSources(sources);

    expect(sources).toEqual(original);
  });
});

describe("validateProvenance", () => {
  //#given entry with tier-1 source
  //#when validateProvenance is called
  //#then valid=true and no warnings
  it("returns valid=true for entry with tier-1 source", () => {
    const entry: TaxonomyEntry = {
      category: "test-category",
      solutions: [
        {
          name: "solution1",
          description: "desc",
          sources: [
            {
              ref: "ref1",
              claim: "claim1",
              tier: "tier-1-ground-truth",
              confidence: 0.95,
              type: "spec",
            },
          ],
        },
      ],
      related: [],
    };

    const result = validateProvenance(entry);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  //#given entry with tier-2 source
  //#when validateProvenance is called
  //#then valid=true and no warnings
  it("returns valid=true for entry with tier-2 source", () => {
    const entry: TaxonomyEntry = {
      category: "test-category",
      solutions: [
        {
          name: "solution1",
          description: "desc",
          sources: [
            {
              ref: "ref1",
              claim: "claim1",
              tier: "tier-2-validated-reference",
              confidence: 0.9,
              type: "paper",
            },
          ],
        },
      ],
      related: [],
    };

    const result = validateProvenance(entry);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  //#given entry with only tier-4 sources
  //#when validateProvenance is called
  //#then valid=true but warning about community-only sources
  it("returns valid=true with warning for entry with only tier-4 sources", () => {
    const entry: TaxonomyEntry = {
      category: "test-category",
      solutions: [
        {
          name: "solution1",
          description: "desc",
          sources: [
            {
              ref: "ref1",
              claim: "claim1",
              tier: "tier-4-community",
              confidence: 0.8,
              type: "blog",
            },
          ],
        },
      ],
      related: [],
    };

    const result = validateProvenance(entry);

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain(
      "Solution 'solution1' has only community-tier sources"
    );
  });

  //#given entry with mix of tier-1 and tier-4 sources
  //#when validateProvenance is called
  //#then valid=true and no warnings (has higher tier)
  it("returns valid=true with no warnings for mixed-tier sources", () => {
    const entry: TaxonomyEntry = {
      category: "test-category",
      solutions: [
        {
          name: "solution1",
          description: "desc",
          sources: [
            {
              ref: "ref1",
              claim: "claim1",
              tier: "tier-1-ground-truth",
              confidence: 0.95,
              type: "spec",
            },
            {
              ref: "ref2",
              claim: "claim2",
              tier: "tier-4-community",
              confidence: 0.7,
              type: "blog",
            },
          ],
        },
      ],
      related: [],
    };

    const result = validateProvenance(entry);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  //#given entry with multiple solutions, one with only tier-4
  //#when validateProvenance is called
  //#then warning only for that solution
  it("warns only for solutions with tier-4-only sources", () => {
    const entry: TaxonomyEntry = {
      category: "test-category",
      solutions: [
        {
          name: "solution1",
          description: "desc",
          sources: [
            {
              ref: "ref1",
              claim: "claim1",
              tier: "tier-1-ground-truth",
              confidence: 0.95,
              type: "spec",
            },
          ],
        },
        {
          name: "solution2",
          description: "desc",
          sources: [
            {
              ref: "ref2",
              claim: "claim2",
              tier: "tier-4-community",
              confidence: 0.8,
              type: "blog",
            },
          ],
        },
      ],
      related: [],
    };

    const result = validateProvenance(entry);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("solution2");
  });

  //#given entry where ALL solutions have only tier-4 sources
  //#when validateProvenance is called
  //#then warning about entry relying entirely on community sources
  it("warns when all solutions have only tier-4 sources", () => {
    const entry: TaxonomyEntry = {
      category: "test-category",
      solutions: [
        {
          name: "solution1",
          description: "desc",
          sources: [
            {
              ref: "ref1",
              claim: "claim1",
              tier: "tier-4-community",
              confidence: 0.8,
              type: "blog",
            },
          ],
        },
        {
          name: "solution2",
          description: "desc",
          sources: [
            {
              ref: "ref2",
              claim: "claim2",
              tier: "tier-4-community",
              confidence: 0.75,
              type: "blog",
            },
          ],
        },
      ],
      related: [],
    };

    const result = validateProvenance(entry);

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain(
      "Entry 'test-category' relies entirely on community sources"
    );
  });

  //#given entry with tier-3 sources
  //#when validateProvenance is called
  //#then valid=true and no warnings
  it("returns valid=true for entry with tier-3 sources", () => {
    const entry: TaxonomyEntry = {
      category: "test-category",
      solutions: [
        {
          name: "solution1",
          description: "desc",
          sources: [
            {
              ref: "ref1",
              claim: "claim1",
              tier: "tier-3-battle-tested",
              confidence: 0.9,
              type: "oss",
            },
          ],
        },
      ],
      related: [],
    };

    const result = validateProvenance(entry);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
