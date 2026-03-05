import type { TaxonomyEntry } from "../agents/coeus/taxonomy/schema";
import { TaxonomyStore } from "../agents/coeus/taxonomy/storage";

export interface TaxonomyClient {
  query(category: string): Promise<TaxonomyEntry | null>;
  queryRelated(category: string): Promise<TaxonomyEntry[]>;
  queryMultiple(categories: string[]): Promise<Map<string, TaxonomyEntry | null>>;
}

export function createLocalTaxonomyClient(taxonomyDir: string): TaxonomyClient {
  const store = new TaxonomyStore();

  return {
    async query(category: string): Promise<TaxonomyEntry | null> {
      return store.search(category);
    },

    async queryRelated(category: string): Promise<TaxonomyEntry[]> {
      return store.searchRelated(category);
    },

    async queryMultiple(
      categories: string[]
    ): Promise<Map<string, TaxonomyEntry | null>> {
      const results = new Map<string, TaxonomyEntry | null>();
      for (const category of categories) {
        results.set(category, store.search(category));
      }
      return results;
    },
  };
}
