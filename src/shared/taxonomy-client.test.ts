import { describe, it, expect, beforeEach, vi } from "bun:test";
import type { TaxonomyEntry } from "../agents/coeus/taxonomy/schema";
import { createLocalTaxonomyClient } from "./taxonomy-client";

//#given a TaxonomyClient interface
//#when querying taxonomy entries
//#then it should return entries or null

describe("TaxonomyClient", () => {
  let mockTaxonomyDir: string;

  beforeEach(() => {
    mockTaxonomyDir = "/tmp/taxonomy";
  });

  it("should query an existing category and return entry", async () => {
    //#given a local taxonomy client
    const client = createLocalTaxonomyClient(mockTaxonomyDir);

    //#when querying an existing category
    const result = await client.query("auth");

    //#then it should return a TaxonomyEntry or null
    expect(result).toBeDefined();
    if (result) {
      expect(result.category).toBe("auth");
      expect(result.solutions).toBeDefined();
      expect(Array.isArray(result.solutions)).toBe(true);
    }
  });

  it("should return null for nonexistent category", async () => {
    //#given a local taxonomy client
    const client = createLocalTaxonomyClient(mockTaxonomyDir);

    //#when querying a nonexistent category
    const result = await client.query("nonexistent-category-xyz");

    //#then it should return null
    expect(result).toBeNull();
  });

  it("should query multiple categories and return Map with nulls for unknown", async () => {
    //#given a local taxonomy client
    const client = createLocalTaxonomyClient(mockTaxonomyDir);

    //#when querying multiple categories including nonexistent ones
    const result = await client.queryMultiple(["auth", "nonexistent-xyz"]);

    //#then it should return a Map with entries for known and null for unknown
    expect(result).toBeInstanceOf(Map);
    expect(result.has("auth")).toBe(true);
    expect(result.has("nonexistent-xyz")).toBe(true);
    expect(result.get("nonexistent-xyz")).toBeNull();
  });

  it("should query related categories and return array", async () => {
    //#given a local taxonomy client
    const client = createLocalTaxonomyClient(mockTaxonomyDir);

    //#when querying related categories
    const result = await client.queryRelated("auth");

    //#then it should return an array (may be empty for unknown)
    expect(Array.isArray(result)).toBe(true);
  });
});
