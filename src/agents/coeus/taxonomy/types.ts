import type { TaxonomyEntry } from "./schema";

export interface TaxonomyQuery {
  search(category: string): TaxonomyEntry | null;
  searchRelated(category: string): TaxonomyEntry[];
}
