import { describe, it, expect } from "bun:test";
import { TaxonomyStore } from "./storage";
import type { TaxonomyEntry } from "./schema";

function makeEntry(
  category: string,
  related: string[] = []
): TaxonomyEntry {
  return {
    category,
    solutions: [
      {
        name: `${category} solution`,
        description: `A solution for ${category}`,
        sources: [
          {
            ref: "CLRS Ch.2",
            claim: `${category} runs in O(n log n)`,
            tier: "tier-1-ground-truth",
            confidence: 0.95,
            type: "textbook",
          },
        ],
      },
    ],
    related,
  };
}

describe("TaxonomyStore", () => {
  describe("empty store", () => {
    //#given an empty store
    const store = new TaxonomyStore();

    it("search returns null", () => {
      //#when searching
      //#then returns null
      expect(store.search("anything")).toBeNull();
    });

    it("searchRelated returns empty", () => {
      //#when searching related
      //#then returns empty array
      expect(store.searchRelated("anything")).toEqual([]);
    });

    it("size returns 0", () => {
      expect(store.size()).toBe(0);
    });

    it("getAllCategories returns empty", () => {
      expect(store.getAllCategories()).toEqual([]);
    });
  });

  describe("addEntry + search", () => {
    it("stores valid entry and retrieves it", () => {
      //#given a store with one entry
      const store = new TaxonomyStore();
      const entry = makeEntry("MergeSort", ["QuickSort"]);

      //#when adding and searching
      store.addEntry(entry);

      //#then retrieves the entry
      expect(store.search("MergeSort")).toEqual(entry);
    });

    it("exact match case-sensitive", () => {
      //#given entry stored as "MergeSort"
      const store = new TaxonomyStore();
      store.addEntry(makeEntry("MergeSort"));

      //#when searching "MergeSort"
      //#then finds it
      expect(store.search("MergeSort")?.category).toBe("MergeSort");
    });

    it("exact match case-insensitive", () => {
      //#given entry stored as "MergeSort"
      const store = new TaxonomyStore();
      store.addEntry(makeEntry("MergeSort"));

      //#when searching "mergesort" (all lowercase)
      //#then finds it
      expect(store.search("mergesort")?.category).toBe("MergeSort");
    });

    it("substring match fallback", () => {
      //#given entry stored as "MergeSort"
      const store = new TaxonomyStore();
      store.addEntry(makeEntry("MergeSort"));

      //#when searching "Merge" (substring)
      //#then finds "MergeSort"
      expect(store.search("Merge")?.category).toBe("MergeSort");
    });

    it("returns null for non-existent", () => {
      //#given a store with entries
      const store = new TaxonomyStore();
      store.addEntry(makeEntry("MergeSort"));

      //#when searching for something that doesn't exist
      //#then returns null
      expect(store.search("NonExistent")).toBeNull();
    });

    it("throws on invalid entry", () => {
      //#given an invalid entry (empty category)
      const store = new TaxonomyStore();
      const invalid = { category: "", solutions: [], related: [] };

      //#when adding
      //#then throws
      expect(() => store.addEntry(invalid as TaxonomyEntry)).toThrow();
    });
  });

  describe("searchRelated", () => {
    it("returns entries in related array", () => {
      //#given MergeSort related to QuickSort and HeapSort
      const store = new TaxonomyStore();
      store.addEntry(makeEntry("MergeSort", ["QuickSort", "HeapSort"]));
      store.addEntry(makeEntry("QuickSort"));
      store.addEntry(makeEntry("HeapSort"));

      //#when searching related for MergeSort
      const related = store.searchRelated("MergeSort");

      //#then returns QuickSort and HeapSort
      const categories = related.map((e) => e.category);
      expect(categories).toContain("QuickSort");
      expect(categories).toContain("HeapSort");
      expect(related).toHaveLength(2);
    });

    it("skips missing related entries gracefully", () => {
      //#given MergeSort related to QuickSort and NonExistent
      const store = new TaxonomyStore();
      store.addEntry(makeEntry("MergeSort", ["QuickSort", "NonExistent"]));
      store.addEntry(makeEntry("QuickSort"));

      //#when searching related
      const related = store.searchRelated("MergeSort");

      //#then only returns QuickSort, skips NonExistent
      expect(related).toHaveLength(1);
      expect(related[0].category).toBe("QuickSort");
    });

    it("returns empty for entry with no related", () => {
      //#given entry with empty related array
      const store = new TaxonomyStore();
      store.addEntry(makeEntry("MergeSort", []));

      //#when searching related
      //#then returns empty
      expect(store.searchRelated("MergeSort")).toEqual([]);
    });

    it("returns empty for non-existent entry", () => {
      //#given store without the queried entry
      const store = new TaxonomyStore();

      //#when searching related for missing entry
      //#then returns empty
      expect(store.searchRelated("Missing")).toEqual([]);
    });
  });

  describe("loadFromJson", () => {
    it("loads valid array", () => {
      //#given valid JSON array
      const store = new TaxonomyStore();
      const data = [
        makeEntry("MergeSort", ["QuickSort"]),
        makeEntry("QuickSort"),
      ];

      //#when loading
      const result = store.loadFromJson(data);

      //#then loads all entries
      expect(result.loaded).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(store.size()).toBe(2);
    });

    it("reports errors for mixed valid/invalid", () => {
      //#given mix of valid and invalid entries
      const store = new TaxonomyStore();
      const data = [
        makeEntry("MergeSort"),
        { category: "", solutions: [], related: [] }, // invalid
        makeEntry("QuickSort"),
      ];

      //#when loading
      const result = store.loadFromJson(data);

      //#then loads valid, reports errors
      expect(result.loaded).toBe(2);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(store.size()).toBe(2);
    });

    it("handles empty array", () => {
      //#given empty array
      const store = new TaxonomyStore();

      //#when loading
      const result = store.loadFromJson([]);

      //#then zero loaded, zero errors
      expect(result.loaded).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("getAllCategories + size", () => {
    it("returns all stored categories", () => {
      //#given store with 3 entries
      const store = new TaxonomyStore();
      store.addEntry(makeEntry("MergeSort"));
      store.addEntry(makeEntry("QuickSort"));
      store.addEntry(makeEntry("HeapSort"));

      //#when getting categories
      const categories = store.getAllCategories();

      //#then returns all 3
      expect(categories).toHaveLength(3);
      expect(categories).toContain("MergeSort");
      expect(categories).toContain("QuickSort");
      expect(categories).toContain("HeapSort");
    });

    it("size returns correct count", () => {
      //#given store with entries
      const store = new TaxonomyStore();
      store.addEntry(makeEntry("A"));
      store.addEntry(makeEntry("B"));

      //#then size matches
      expect(store.size()).toBe(2);
    });
  });
});
