import { describe, expect, test } from "bun:test";
import { TaxonomyEntrySchema } from "../schema";
import { mergeSortEntry } from "./merge-sort";
import { rateLimitingEntry } from "./rate-limiting";
import { authenticationEntry } from "./authentication";
import { cachingEntry } from "./caching";
import { SEED_ENTRIES } from "./index";

describe("Taxonomy Seed Data", () => {
  //#given merge-sort entry
  describe("merge-sort.ts", () => {
    test("validates against TaxonomyEntrySchema", () => {
      //#when parsing with schema
      //#then no error thrown
      expect(() => TaxonomyEntrySchema.parse(mergeSortEntry)).not.toThrow();
    });

    test("has CLRS provenance with ISBN", () => {
      //#given merge-sort entry
      //#when checking sources
      const clrsSource = mergeSortEntry.solutions[0].sources.find(
        (s) => s.ref.includes("CLRS") || s.ref.includes("Cormen")
      );
      //#then CLRS source exists with ISBN
      expect(clrsSource).toBeDefined();
      expect(clrsSource?.isbn).toBeDefined();
      expect(clrsSource?.isbn).toMatch(/978-0262046305/);
    });

    test("has tier-1 or tier-2 source", () => {
      //#given merge-sort entry
      //#when checking source tiers
      const highTierSource = mergeSortEntry.solutions[0].sources.find(
        (s) => s.tier === "tier-1-ground-truth" || s.tier === "tier-2-validated-reference"
      );
      //#then at least one high-tier source exists
      expect(highTierSource).toBeDefined();
    });

    test("has non-empty related array", () => {
      //#given merge-sort entry
      //#when checking related
      //#then related array is non-empty
      expect(mergeSortEntry.related.length).toBeGreaterThan(0);
    });
  });

  //#given rate-limiting entry
  describe("rate-limiting.ts", () => {
    test("validates against TaxonomyEntrySchema", () => {
      //#when parsing with schema
      //#then no error thrown
      expect(() => TaxonomyEntrySchema.parse(rateLimitingEntry)).not.toThrow();
    });

    test("has tier-1 or tier-2 source", () => {
      //#given rate-limiting entry
      //#when checking source tiers
      const highTierSource = rateLimitingEntry.solutions.flatMap((s) => s.sources).find(
        (s) => s.tier === "tier-1-ground-truth" || s.tier === "tier-2-validated-reference"
      );
      //#then at least one high-tier source exists
      expect(highTierSource).toBeDefined();
    });

    test("has non-empty related array", () => {
      //#given rate-limiting entry
      //#when checking related
      //#then related array is non-empty
      expect(rateLimitingEntry.related.length).toBeGreaterThan(0);
    });
  });

  //#given authentication entry
  describe("authentication.ts", () => {
    test("validates against TaxonomyEntrySchema", () => {
      //#when parsing with schema
      //#then no error thrown
      expect(() => TaxonomyEntrySchema.parse(authenticationEntry)).not.toThrow();
    });

    test("has tier-1 or tier-2 source (RFC)", () => {
      //#given authentication entry
      //#when checking source tiers
      const highTierSource = authenticationEntry.solutions.flatMap((s) => s.sources).find(
        (s) => s.tier === "tier-1-ground-truth" || s.tier === "tier-2-validated-reference"
      );
      //#then at least one high-tier source exists
      expect(highTierSource).toBeDefined();
    });

    test("has non-empty related array", () => {
      //#given authentication entry
      //#when checking related
      //#then related array is non-empty
      expect(authenticationEntry.related.length).toBeGreaterThan(0);
    });
  });

  //#given caching entry
  describe("caching.ts", () => {
    test("validates against TaxonomyEntrySchema", () => {
      //#when parsing with schema
      //#then no error thrown
      expect(() => TaxonomyEntrySchema.parse(cachingEntry)).not.toThrow();
    });

    test("has tier-1 or tier-2 source", () => {
      //#given caching entry
      //#when checking source tiers
      const highTierSource = cachingEntry.solutions.flatMap((s) => s.sources).find(
        (s) => s.tier === "tier-1-ground-truth" || s.tier === "tier-2-validated-reference"
      );
      //#then at least one high-tier source exists
      expect(highTierSource).toBeDefined();
    });

    test("has non-empty related array", () => {
      //#given caching entry
      //#when checking related
      //#then related array is non-empty
      expect(cachingEntry.related.length).toBeGreaterThan(0);
    });
  });

  //#given SEED_ENTRIES array
  describe("index.ts", () => {
    test("exports SEED_ENTRIES with length 4", () => {
      //#when checking SEED_ENTRIES
      //#then array has 4 entries
      expect(SEED_ENTRIES).toBeDefined();
      expect(SEED_ENTRIES.length).toBe(4);
    });

    test("all entries validate against schema", () => {
      //#given SEED_ENTRIES array
      //#when validating each entry
      //#then all entries pass schema validation
      SEED_ENTRIES.forEach((entry, idx) => {
        expect(() => TaxonomyEntrySchema.parse(entry)).not.toThrow();
      });
    });

    test("all entries have at least one tier-1 or tier-2 source", () => {
      //#given SEED_ENTRIES array
      //#when checking source tiers
      //#then each entry has at least one high-tier source
      SEED_ENTRIES.forEach((entry) => {
        const highTierSource = entry.solutions.flatMap((s) => s.sources).find(
          (s) => s.tier === "tier-1-ground-truth" || s.tier === "tier-2-validated-reference"
        );
        expect(highTierSource).toBeDefined();
      });
    });
  });
});
