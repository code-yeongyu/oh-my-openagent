import { TaxonomyEntrySchema, type TaxonomyEntry } from "./schema";
import type { TaxonomyQuery } from "./types";

export class TaxonomyStore implements TaxonomyQuery {
  private entries: Map<string, TaxonomyEntry> = new Map();

  addEntry(entry: TaxonomyEntry): void {
    const validated = TaxonomyEntrySchema.parse(entry);
    this.entries.set(validated.category.toLowerCase(), validated);
  }

  loadFromJson(data: unknown[]): { loaded: number; errors: string[] } {
    let loaded = 0;
    const errors: string[] = [];

    for (let i = 0; i < data.length; i++) {
      const result = TaxonomyEntrySchema.safeParse(data[i]);
      if (result.success) {
        this.entries.set(result.data.category.toLowerCase(), result.data);
        loaded++;
      } else {
        errors.push(`Entry ${i}: ${result.error.message}`);
      }
    }

    return { loaded, errors };
  }

  search(category: string): TaxonomyEntry | null {
    const key = category.toLowerCase();

    const exact = this.entries.get(key);
    if (exact) return exact;

    for (const [storedKey, entry] of this.entries) {
      if (storedKey.includes(key)) return entry;
    }

    return null;
  }

  searchRelated(category: string): TaxonomyEntry[] {
    const entry = this.search(category);
    if (!entry) return [];

    const related: TaxonomyEntry[] = [];
    for (const relatedCategory of entry.related) {
      const found = this.search(relatedCategory);
      if (found) related.push(found);
    }
    return related;
  }

  getAllCategories(): string[] {
    return [...this.entries.values()].map((e) => e.category);
  }

  size(): number {
    return this.entries.size;
  }
}
